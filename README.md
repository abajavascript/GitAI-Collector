# Git AI Collector

Ingest service for the Git AI CLI. It accepts the CLI's worker uploads and stores them in SQLite. It is not Git AI Cloud: there is no login, OAuth, Sentry, or PostHog here.

Requires Node.js 22 or newer. Storage uses the built-in `node:sqlite` module, so Windows does not need a native addon.

## Run

```bash
npm install
npm test
npm run dev
```

`npm start` runs the compiled server after `npm run build`.

The process listens on `127.0.0.1:8080` unless `HOST` and `PORT` are set. Copy `.env.example` and export the variables in your shell. API keys and bearer tokens are read from the environment and are not written to logs.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `8080` | Listen port |
| `SQLITE_PATH` | `data/collector.sqlite` | SQLite file. `:memory:` keeps data in process memory |
| `API_KEYS` | empty | Comma-separated `X-API-Key` values |
| `BEARER_TOKENS` | empty | Comma-separated `Authorization: Bearer` tokens |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:$PORT` | Base URL used in bundle links |

`GET /health` checks that the store is open and does not require a credential. Every other route accepts the request when `X-API-Key` matches a value in `API_KEYS`, or when `Authorization: Bearer` matches a value in `BEARER_TOKENS`. When both headers are present, a matching API key is enough, because the CLI also sends a Git AI Cloud login token. A request with neither match responds `401`. `X-Distinct-ID` and `X-Author-Identity` are stored with each accepted row. The CLI percent-encodes non-ASCII author identities, and those values are decoded before storage.

## CLI

Point the Git AI CLI at this service with `GIT_AI_API_BASE_URL` and `GIT_AI_API_KEY`. The CLI skips these uploads unless an API key or a login token is present. Prompt upload follows the CLI `prompt_storage` setting. `default` sends prompts to CAS.
