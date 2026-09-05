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

## Adding a new test case

Add an entry to `tests/cases.json` with a unique `id`, the exact text,
`tags` for what it's probing, and a `note` on why it exists — then run the
suite and add a short paragraph here on what it revealed, good or bad.
