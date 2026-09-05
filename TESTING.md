# Testing log

The goal is to get the correction engine good enough, fast enough, and
reliable enough that it's worth eventually shipping as a browser extension
or a clean open-source local editor. Getting there means testing against
real sentences repeatedly and tracking what actually improved each time,
rather than trusting a one-off "looks good" check.

## How it works

- [`tests/cases.json`](tests/cases.json) — the running set of test
  sentences/paragraphs. Each has an `id`, `tags` describing what it's
  probing for, and a `note` on why it exists.
- [`tests/run_tests.py`](tests/run_tests.py) — runs every case against a
  live server, times each one, and appends a record to
  `tests/results.jsonl` (gitignored — it's a local run log, not something
  to commit) so speed and output can be compared run over run.

```
python server.py            # in one terminal
python tests/run_tests.py   # in another
```

Each run prints a `faster/slower than last run` delta and flags if a
case's output changed since the previous run, so a regression (or a real
improvement) is visible immediately instead of relying on memory.

**Scope note:** `run_tests.py` hits `/api/correct` directly — it only
exercises the server-side LLM pass, not the client-side local dictionary
(`corrections.js`) that runs in the browser first. A case can show the LLM
alone leaving something like "def" unfixed even though the full in-browser
pipeline fixes it earlier, client-side, before the sentence ever reaches
the server. Worth remembering when reading a result: "the server's output
still has X" isn't necessarily a real gap if X is the local dictionary's job.

## What we've learned so far

**grammar-basic-1** ("me and him dont went to the store...") was the
original proof that the LLM pass earns its keep beyond the dictionary:
pronoun case, subject-verb agreement, and tense are the kind of thing no
dictionary lookup could ever fix. Stable and correct across every run.

**quote-insertion-1** and **run-on-1** confirmed the LLM will add
punctuation that's genuinely missing (quotes around reported speech, a
comma before a contrasting clause, splitting/joining run-on clauses) — but
also surfaced that the model has real discretion over *how* it fixes a
run-on (a period vs. a semicolon vs. "and") and doesn't produce
byte-identical output every single run, even with `temperature: 0` set.
That's a known characteristic of hosted LLM APIs (not fully bit-
deterministic even at temperature 0), not a bug in our code — the fix
itself is consistently correct, just not always phrased identically.
Worth remembering when judging "did this get worse": a changed sentence
isn't automatically a regression, only a wrong one is.

**abbrev-1** is the user's own real dogfooding sentence, kept verbatim.
It's what surfaced "def" not being in the local dictionary, and it's what
first surfaced the typing-speed bug below (found by actually using the
editor, not by reading the code).

**possessive-safety-1** is a regression guard for a real bug we shipped
and caught once already: an earlier version of the local dictionary force-
corrected every "its" to "it's", silently breaking correct possessive
sentences. This case must always come back unchanged (or only lightly
re-punctuated) — if it ever gets rewritten to "it's", something regressed.

### Performance investigation (2026-09-05)

The user reported the editor getting "way slower" the faster they typed,
recovering once they hit a period. Root cause traced to `updateToolbarState()`
running 8 synchronous `document.queryCommandState()` calls on every
`selectionchange` event — which fires on *every keystroke* (typing moves
the caret), not just on deliberate selections. Measured directly: ~1ms of
blocking work per keystroke, spiking to 2ms, compounding at typing speed.
Fixed by coalescing to at most one update per animation frame — confirmed
via microbenchmark: ~70x less overhead (0.9ms vs. 64.6ms for the same 60
events).

### Latency variance investigation (2026-09-05)

Running the test suite back-to-back surfaced latencies far higher than the
sub-1s we'd measured in earlier, more spaced-out testing (up to 6s+, one
outright 502 when every configured key failed within its timeout window).
Traced this by testing **Gemini directly, no proxy involved** — same
escalating slowdown (0.8s → 4.1s → 3.3s) on repeated rapid calls against a
single key. This is free-tier soft-throttling on Google's side (steadily
increasing latency, not a hard rate-limit error), not something in our
code. Two concrete mitigations shipped:
- Round-robin across all configured keys per provider (we have 3 Gemini
  keys sitting mostly unused after the first) instead of always hitting
  key #1 first, so back-to-back sentences — a completely normal typing
  pattern — spread load instead of hammering one key into throttling.
- Reduced the per-key timeout from 15s to 6s, so a single hung key can't
  make the whole request pile up past what the client is even willing to
  wait for (the browser's own `AbortController` gives up at 7s).
- Also fixed: Gemini calls weren't setting `temperature: 0` (Groq's were)
  and were jamming the system prompt into the user message instead of
  using Gemini's dedicated `systemInstruction` field — both fixed for
  more consistent, reliable output.

Honest current state: latency is now *usually* well under 3s and
consistently correct, but still shows occasional multi-second outliers
under rapid repeated use — an inherent property of relying on free API
tiers, not something fully solvable without paying for dedicated capacity.
Worth tracking over time via the test log rather than treating as solved.

### Mid-sentence latency + fragment-casing investigation (2026-09-05)

User dogfooding (**mid-sentence-typo-1**) surfaced two more real bugs:

1. "steek" (misspelled "steak") sat uncorrected until the sentence's final
   period even though it came right after a comma several words earlier —
   the smart-correction dispatch only ever triggered on `. ! ?`, never on
   commas. Fixed: commas now count as a dispatch boundary too, so each
   comma-delimited clause gets its own trip to the LLM as soon as it's
   typed, not just the whole sentence at the end.
2. This surfaced a second, more subtle bug: sending an isolated mid-
   sentence clause (e.g. "though maybe one day...") gives the model no way
   to know it's a *continuation*, not a new sentence — it capitalized
   "Though" anyway, even after the system prompt was updated to explicitly
   warn about this exact case (a lowercase conjunction/subordinator start
   is very likely correct). Prompting alone wasn't reliable enough. Fixed
   properly instead: since our own code already knows for certain whether
   a dispatched fragment is a true sentence start (`isSentenceStart`,
   computed from the *whole* document, which the model never sees), we now
   enforce that client-side after the fact — if we know it's not a
   sentence start and the model capitalized it anyway, we force it back
   down rather than trust the model's guess on this one specific thing.

Also found while testing this: comma-boundary dispatch means several
requests can now land in the same instant under fast/burst typing, so a
single request more often needs 2-3 sequential key attempts before
succeeding (each attempt bounded to 5s) — the client's own abort timeout
was tightened to 7s during the earlier latency investigation, which was
short enough to abort a legitimately-slow-but-still-successful request
before it ever came back, silently dropping the correction entirely (not
just delaying it — confirmed via a real `AbortError` in the console).
Widened to 22s (comfortably over the worst-case sequential chain through
all 5 configured keys) so a correction is only ever lost if every key
genuinely fails, never just because it took a while.

### Rebrand + file save/load + functional menus (2026-09-05)

This batch was UI/architecture, not correction-engine work, so it's not
covered by `run_tests.py` — verified by hand instead: purple accent color
throughout, the document icon and favicon both recolored and mirrored
(folded corner now top-left), a real `docs/` folder-backed save/open/new/
download flow (`Ctrl+S`, the File menu, and clicking the document icon all
exercised end-to-end — a saved file was confirmed on disk, then reopened
via the file browser with formatting intact, and Save As confirmed to
create a second file rather than overwriting the first), and all 8
menu-bar categories wired to real actions.

Caught one real bug before it shipped: `.menu-dropdown` and `.modal-
overlay` both set `display: flex` unconditionally, which has the *same*
CSS specificity as the browser's built-in `[hidden] { display: none }`
rule — and came later in the stylesheet, so it silently won, meaning
every dropdown and the file-browser modal were visible on page load
instead of hidden. Fixed with an explicit `.menu-dropdown[hidden] {
display: none }` (and the same for `.modal-overlay`) to out-specificity
the base rule. Worth remembering for any future `[hidden]`-toggled element
that also carries its own `display` rule.

Also re-ran the full correction-engine test suite after all this UI work
to make sure none of it broke the core feature — all 6 cases still pass,
latency back down to a healthy 2.5-2.9s across the board (the earlier
outliers were rate-limit pressure from this session's own heavy testing,
not a real regression — confirms that theory).

### Key exhaustion + hedged requests (2026-09-05)

User dogfooding reported a real, complete failure: a two-sentence
paragraph with an obvious typo ("jsut") came back completely unchanged
after 10-15 seconds. Investigating each configured key individually found
the root cause: **`GEMINI_API_KEY_3` is now permanently banned** — `403,
"Your project has been denied access. Please contact support."` — almost
certainly triggered by this session's own very heavy automated testing
today (hundreds of rapid calls in a short window looks like abuse to
Google's systems). Both Groq keys remain network-blocked as before. That
leaves only 2 working keys out of 5 configured.

`correct_sentence()`'s original design tried keys strictly one at a time,
in order. If round-robin ever put the dead key first, that was fine (it
fails in ~0.2s) — but if a *live* key happened to be slow that request
(the same free-tier soft-throttling documented earlier), the whole
request waited through that key's full timeout before ever trying the
one that would have worked. That's what produced the 10-15s failures.

First attempt at a fix — fire every configured key concurrently on every
request, take the first success — cut single-request latency nicely (5
consecutive calls all under 1.4s) but running the test suite back-to-back
immediately produced two 502s that weren't happening before: hitting both
live keys simultaneously on *every* request measurably increases how often
they get rate-limited together, which is the opposite of what we want
given we've already lost one key that way today.

Replaced with a **hedged request** instead: fire one key; only bring in
the next one concurrently once 1.5s passes with no answer, or the moment
the current one fails outright (a second bug caught while testing this:
the first version only hedged on a *timeout*, not a *fast failure*, so
the dead key's near-instant 403 could empty the pending set and fail the
whole request in under a second even with working keys available —
fixed to launch the next key immediately whenever nothing is left in
flight and keys remain). This keeps the common case down to one key's
quota per request while still bounding the worst case.

Honest result: real, measurable improvement in the common case, but
during this same investigation both remaining live keys started showing
outright 503s and a hard 5s timeout — evidence we (between real usage and
this investigation's own testing) have likely pushed today's free-tier
quota close to its limit. No amount of client-side retry logic can fix an
actually-exhausted quota. Worth remembering this specific ceiling exists
and treating persistent failures *on a single day of heavy use* as
possible quota exhaustion, not automatically a new code regression —
check by testing a key directly against the provider's API before
assuming the bug is in `server.py`.

### Added Cerebras as the primary provider (2026-09-05)

Directly addressed the quota-exhaustion problem above rather than just
working around it: added Cerebras (`cloud.cerebras.ai`) as a third
provider, tried first in `correct_sentence()`. It's a genuinely separate,
fresh free-tier quota (1M tokens/day) on a different account from the
Gemini keys we'd been hammering all day — spreads real load across
independent limits instead of collecting more keys against the same one.
Model: `qwen-3.8-27b` (the smaller of Cerebras' two public models — the
right fit for a fast, simple correction task, not the larger `gpt-oss-120b`).

Verified with 5 consecutive real requests: consistently 1.0-1.3s each,
correct every time — noticeably faster and more reliable than Gemini was
even before today's quota pressure. Full test suite re-run afterward:
all 6 cases pass, no errors, healthy 2.7-2.9s (one 4.2s hedge outlier,
still correct).

## Adding a new test case

Add an entry to `tests/cases.json` with a unique `id`, the exact text,
`tags` for what it's probing, and a `note` on why it exists — then run the
suite and add a short paragraph here on what it revealed, good or bad.
