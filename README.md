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

Since it's plain ES modules, it needs to be served over HTTP rather than
opened as a `file://` URL — e.g. `python -m http.server` in this folder,
then visit `http://localhost:<port>/`.

## Phase 2: smarter corrections via a free LLM

Optional — paste a free [Groq](https://console.groq.com/keys) or
[Gemini](https://aistudio.google.com/apikey) API key into the in-page settings
panel. It's stored only in your browser's `localStorage`, never committed to
this repo, and calls go straight from your browser to the provider.

If you want a `.env` for local scripting/testing instead, copy
`.env.example` to `.env` and fill in your key — `.env` is gitignored.
