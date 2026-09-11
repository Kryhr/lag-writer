# lag-writer

A free writing assistant that trails a few words behind you as you type,
quietly fixing typos, missing apostrophes, and shorthand (tbh, lmk, u, idk...)
in what you already wrote — like a lightweight, self-hosted Grammarly, built
because the real ones cost money.

See [PLAN.md](PLAN.md) for the phased build plan.

## Phase 1 (current): full Docs-style editor, no API key needed

`index.html` is a Google Docs-style document editor (title, menu bar with
working File/Edit/View/Insert/Format/Tools/Extensions/Help menus,
formatting toolbar — bold/italic/underline, fonts, sizes, colors, alignment,
lists, links, images), real local file save/open/new/download backed by a
`docs/` folder, and its own purple branding (not a Google clone). Type
normally; a few words behind your cursor, and instantly whenever you finish
a sentence with `.`/`!`/`?`/`,`, the correction engine silently fixes typos,
missing apostrophes, shorthand (tbh, lmk, u, idk...), and acronym
capitalization (ai -> AI, nasa -> NASA...) — no network calls, no API key.
The local dictionary (`corrections.js`) currently has **~730 entries** and
is an ongoing, actively-growing effort — see [TESTING.md](TESTING.md) for
the running log of what's been added and why.

## Phase 2 (current): smarter grammar fixes via an LLM, any provider you want

Copy `.env.example` to `.env` and fill in a key for **any one (or several)**
of the providers it lists — you only need one to run the app at all. Adding
a provider is just pasting its key into the matching `.env` line; nothing
else to configure. Multiple keys per provider are supported too:
`GEMINI_API_KEY`, `GEMINI_API_KEY_2`, etc.

Currently wired up (tried in this order, each with automatic hedging across
its own multiple keys and a circuit breaker that skips a provider for 60s
after 3 failures in a row rather than taxing every request):

1. [Cerebras](https://cloud.cerebras.ai)
2. [Groq](https://console.groq.com/keys)
3. [Gemini](https://aistudio.google.com/apikey)
4. [OpenRouter](https://openrouter.ai/keys)
5. [Together](https://api.together.ai/settings/api-keys)
6. [Mistral](https://console.mistral.ai/api-keys)
7. [Fireworks](https://fireworks.ai/account/api-keys)
8. [DeepInfra](https://deepinfra.com/dash/api_keys)
9. [Cohere](https://dashboard.cohere.com/api-keys)
10. [GitHub Models](https://github.com/marketplace/models)
11. [Novita](https://novita.ai/settings/key-management)
12. [Hyperbolic](https://app.hyperbolic.xyz/settings)
13. [SambaNova](https://cloud.sambanova.ai/apis)
14. [Anthropic (Claude)](https://console.anthropic.com/settings/keys) — paid, no free tier, but supported if you have a key
15. [Perplexity](https://www.perplexity.ai/settings/api)
16. [xAI (Grok)](https://console.x.ai)
17. [DeepSeek](https://platform.deepseek.com/api_keys)
18. [Moonshot (Kimi)](https://platform.moonshot.ai/console/api-keys)
19. [Qwen (DashScope)](https://dashscope.console.aliyun.com/apiKey)
20. [AI21](https://studio.ai21.com/account/api-key)
21. [Nebius AI Studio](https://studio.nebius.ai/settings/api-keys)
22. [Scaleway](https://console.scaleway.com/iam/api-keys)
23. [Lambda](https://cloud.lambda.ai/api-keys)
24. [Featherless](https://featherless.ai/account/api-keys)

Full details (exact env var names, sign-up links) are in `.env.example`.
Adding a 25th provider just means one more entry in `server.py`'s
`PROVIDERS` list — see the comment above it.

Then run:

```
python server.py
```

and open `http://localhost:8756/`. This is a tiny local proxy — it serves
the static site *and* relays each completed sentence/clause to the LLM
server-side, so no API key ever reaches the browser (never expose one in
client-side JS in a public repo). The local dictionary pass (Phase 1) still
runs first and instantly; a moment later, the LLM pass silently fixes real
grammar errors the dictionary can't catch (subject-verb agreement, missing
commas, wrong pronoun case, tense, etc.) — same no-visible-log behavior as
Phase 1, with a brief "checking" underline while a check is in flight.

If no keys are configured, or every configured provider fails, the editor
just falls back to the Phase 1 local-only behavior.

## Testing

See [TESTING.md](TESTING.md) for the test-case log and what each one has
revealed so far. Quick version:

```
python server.py            # in one terminal
python tests/run_tests.py   # in another
```
