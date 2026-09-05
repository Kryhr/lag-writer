# lag-writer

A free writing assistant that trails a few words behind you as you type,
quietly fixing typos, missing apostrophes, and shorthand (tbh, lmk, u, idk...)
in what you already wrote — like a lightweight, self-hosted Grammarly, built
because the real ones cost money.

See [PLAN.md](PLAN.md) for the phased build plan.

## Phase 1 (current): full Docs-style editor, no API key needed

`index.html` is a Google Docs-style document editor (title, menu bar,
formatting toolbar — bold/italic/underline, fonts, sizes, colors, alignment,
lists, links). Type normally; a few words behind your cursor, and instantly
whenever you finish a sentence with `.`/`!`/`?`, the correction engine
silently fixes typos, missing apostrophes, and shorthand (tbh, lmk, u, idk...)
and capitalizes "I" and sentence starts — no network calls, no API key.

## Phase 2 (current): smarter grammar fixes via a free LLM

Copy `.env.example` to `.env` and fill in a free
[Groq](https://console.groq.com/keys) and/or
[Gemini](https://aistudio.google.com/apikey) key (`.env` is gitignored —
never commit it). Multiple keys per provider are supported: `GROQ_API_KEY`,
`GROQ_API_KEY_2`, `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, etc.

Then run:

```
python server.py
```

and open `http://localhost:8756/`. This is a tiny local proxy — it serves
the static site *and* relays each completed sentence to the LLM server-side,
so the API key never reaches the browser (never expose it in client-side
JS in a public repo). The local dictionary pass (Phase 1) still runs first
and instantly; a moment later, the LLM pass silently fixes real grammar
errors the dictionary can't catch (subject-verb agreement, wrong
pronoun case, tense, etc.) — same no-visible-log behavior as Phase 1.

If no keys are configured, or both providers fail, the editor just falls
back to the Phase 1 local-only behavior.

## Testing

See [TESTING.md](TESTING.md) for the test-case log and what each one has
revealed so far. Quick version:

```
python server.py            # in one terminal
python tests/run_tests.py   # in another
```
