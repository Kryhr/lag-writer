# lag-writer

A free writing assistant that trails a few words behind you as you type,
quietly fixing typos, missing apostrophes, and shorthand (tbh, lmk, u, idk...)
in what you already wrote — like a lightweight, self-hosted Grammarly, built
because the real ones cost money.

See [PLAN.md](PLAN.md) for the phased build plan.

## Phase 1 (current): local demo, no API key needed

Just open `index.html` in a browser. Type normally — words that fall more
than ~5 words behind your cursor get auto-corrected in place using local
rules (no network calls, no API key).

## Phase 2: smarter corrections via a free LLM

Optional — paste a free [Groq](https://console.groq.com/keys) or
[Gemini](https://aistudio.google.com/apikey) API key into the in-page settings
panel. It's stored only in your browser's `localStorage`, never committed to
this repo, and calls go straight from your browser to the provider.

If you want a `.env` for local scripting/testing instead, copy
`.env.example` to `.env` and fill in your key — `.env` is gitignored.
