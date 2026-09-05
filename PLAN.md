# lag-writer — plan

## Concept
A writing assistant that trails a few words behind you as you type. It doesn't
autocomplete forward — it corrects backward: fixes typos, missing apostrophes,
and expands shorthand (tbh, lmk, u, idk...) in the words you already typed,
once you've moved on far enough that it won't interrupt your flow.

Goal: a free, self-hosted alternative to paid "AI writing assistant" browser
extensions, using free-tier Groq/Gemini API keys instead of a subscription.

## Phases

### Phase 1 — Standalone textarea demo (local rules only, no API key needed)
- Single static page (`index.html` + `app.js` + `style.css`), no build step.
- User types in a big textarea.
- Track a "lag window": the last N words (default ~5) are left alone; anything
  older than that gets passed through a local correction pass.
- Local corrections (no API call, instant, free):
  - common typo fixes via a small misspelling dictionary
  - contraction fixes (dont -> don't, im -> I'm, wasnt -> wasn't, etc.)
  - shorthand expansion (tbh -> to be honest, lmk -> let me know, idk -> I don't know)
- Visual: corrected text is quietly patched in place; optionally flash/underline
  briefly so the user can see what changed.
- Status: **build this first, ship it, it already works without any API key.**

### Phase 2 — Smart pass via free LLM API (Groq or Gemini)
- Add a settings panel: paste a Groq or Gemini API key, stored in
  `localStorage` only (never touches the repo, never sent anywhere but the
  provider's API directly from the browser).
- When a finished sentence scrolls out of the lag window, send just that
  sentence to the LLM with a small prompt: "fix spelling/grammar, preserve
  meaning and voice, return corrected sentence only."
- Debounce + only call on sentence boundaries (. ! ?) to keep API usage low
  and within free tier limits.
- Local rules from Phase 1 still run first/instantly; the LLM pass is a
  slower second opinion that patches in when it disagrees.

### Phase 3 — Browser extension (works in Google Docs, Gmail, anywhere)
- Wrap the same engine as a Chrome/Firefox extension content script.
- Content script watches focused `contenteditable` / textarea elements on any
  page (including Google Docs' editor) and applies the same lag-correction
  logic.
- This is the "actually use it everywhere" version — bigger lift because
  Google Docs' editor isn't a plain textarea (uses a canvas-based renderer in
  some modes), so may need to target Docs' compatibility/plain HTML mode or
  fall back to a simpler contenteditable target (Gmail, plain web forms) first.

## Non-goals (for now)
- Not trying to beat Grammarly on grammar depth — just typos, apostrophes,
  common shorthand, sentence sanity.
- Not building a backend/server for v1 — everything runs client-side, API
  keys stay in the browser's localStorage, never checked into git.

## Current status
- [x] Repo scaffolded
- [x] Phase 1 local-rules demo, rebuilt as a full Docs-style rich text editor
      (toolbar formatting, silent background corrections, sentence-boundary
      trigger, auto-capitalization)
- [x] Phase 2 LLM smart pass — server.py proxies each completed sentence to
      Groq/Gemini (server-side only, key never reaches the browser) and
      silently patches in real grammar fixes the local dictionary can't catch
- [x] Phase 2.1 — switched to gemini-3.5-flash-lite (sub-1s vs. 9-42s on
      3.6-flash), broadened the correction scope to full grammar/punctuation
      (commas, quotes, capitalization — never em dashes, never rewording),
      added a live toolbar control for the lag-word distance, native red
      spellcheck squiggly, and a blue "checking grammar" squiggly while a
      sentence is in flight to the LLM
- [x] Phase 2.2 — dispatches the LLM pass on comma boundaries too (not just
      sentence-ending punctuation), enforces correct capitalization for
      mid-sentence fragments client-side, and widened the request timeout
      so a slow-but-successful correction is never silently dropped
- [x] Phase 2.3 — purple rebrand (was Google blue), favicon, real local
      file save/open/new/download backed by a `docs/` folder next to
      `server.py`, and functional dropdown menus for all 8 menu-bar
      categories (Extensions links out to the GitHub repo — no real
      extension system exists to plug into)
- [ ] Phase 3 browser extension
