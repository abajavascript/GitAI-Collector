# Git AI Collector

Ingest service for the [Git AI CLI](https://github.com/git-ai-project/git-ai). It accepts the CLI's worker uploads and stores them in SQLite. Login, OAuth, Sentry, and PostHog stay on Git AI Cloud. Error telemetry from the CLI still goes to those vendors unless `telemetry_oss` is `off`.

Requires Node.js 22 or newer. Storage uses the built-in `node:sqlite` module, so Windows does not need a native addon.

## Start the collector

Install dependencies from this repository:

```bash
npm install
```

The process reads environment variables. It does not load a `.env` file. Copy `.env.example`, replace `API_KEYS` with a long random value, and export the variables in the same shell that starts the server. `PUBLIC_BASE_URL` should use the same host and port the process listens on, because bundle responses link back to that URL.

PowerShell:

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "8080"
$env:SQLITE_PATH = "data/collector.sqlite"
$env:API_KEYS = "replace-with-a-long-random-key"
$env:BEARER_TOKENS = ""
$env:PUBLIC_BASE_URL = "http://127.0.0.1:8080"
npm run dev
```

bash:

```bash
export HOST=127.0.0.1
export PORT=8080
export SQLITE_PATH=data/collector.sqlite
export API_KEYS=replace-with-a-long-random-key
export BEARER_TOKENS=
export PUBLIC_BASE_URL=http://127.0.0.1:8080
npm run dev
```

`npm run dev` runs the TypeScript entrypoint. For a compiled process, run `npm run build` and then `npm start`. The SQLite file and its parent directory are created on startup. `data/` is gitignored.

`GET /health` checks that the store is open and does not require a credential:

```bash
curl http://127.0.0.1:8080/health
```

A healthy process returns `{"ok": true}`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `8080` | Listen port |
| `SQLITE_PATH` | `data/collector.sqlite` | SQLite file. `:memory:` keeps data in process memory |
| `API_KEYS` | empty | Comma-separated `X-API-Key` values |
| `BEARER_TOKENS` | empty | Comma-separated `Authorization: Bearer` tokens |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:$PORT` | Base URL used in bundle links |

API keys and bearer tokens are read from the environment and are not written to logs.

`GET /health` is the only route that skips authentication. Every other route accepts the request when `X-API-Key` matches a value in `API_KEYS`, or when `Authorization: Bearer` matches a value in `BEARER_TOKENS`. When both headers are present, a matching API key is enough, because the CLI also sends a Git AI Cloud login token. A request with neither match responds `401`. `X-Distinct-ID` and `X-Author-Identity` are stored with each accepted row. The CLI percent-encodes non-ASCII author identities, and those values are decoded before storage.

## Install the Git AI CLI

Install the official CLI on the machine that will send uploads. Run the Windows installer from a normal PowerShell window. An elevated Administrator install creates files the normal user cannot use.

macOS, Linux, and Windows (WSL):

```bash
curl -sSL https://usegitai.com/install.sh | bash
```

Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://usegitai.com/install.ps1 | iex"
```

The installer places the binary at `~/.git-ai/bin/git-ai` (`%USERPROFILE%\.git-ai\bin\git-ai.exe` on Windows), updates `PATH`, and runs `git-ai install-hooks`. Close and reopen the terminal and any IDE or agent session so the new `PATH` and hooks are picked up. Confirm the install with:

```bash
git-ai --version
```

If hooks were not installed, run `git-ai install-hooks`. There is no per-repository setup.

## Point an installed CLI at the collector

An existing Git AI CLI install already has the binary and hooks. Leave that install in place and retarget it with `git ai config set`. The CLI's default base URL is `https://usegitai.com`, so uploads stay on Git AI Cloud until `api_base_url` changes.

The URL has to be reachable from the machine running the CLI and should match the collector's `PUBLIC_BASE_URL`. On the same machine that is `http://127.0.0.1:8080`.

A saved `api_base_url` is used before `GIT_AI_API_BASE_URL`. `git ai config set api_base_url` replaces a URL already stored by an earlier `git ai config set`, or by `API_BASE` during `git-ai install-hooks`. Exporting `GIT_AI_API_BASE_URL` changes the base URL only when the config file has no `api_base_url`.

This collector has no login flow. Set `api_key` to one value from the collector's `API_KEYS`. The CLI skips worker uploads unless `GIT_AI_API_KEY` or a login token is present. `GIT_AI_API_KEY` is used before `api_key` in the config file. A Git AI Cloud login token does not select this collector's URL.

On macOS and Linux the file is `$HOME/.git-ai/config.json`. On Windows it is `%USERPROFILE%\.git-ai\config.json`.

```bash
git ai config set api_base_url http://127.0.0.1:8080
git ai config set api_key replace-with-a-long-random-key
git ai config set telemetry_oss off
git ai config
```

`git ai config` prints the effective configuration. `api_base_url` in that output is the URL the CLI will call. The printed `api_key` is the value stored in the file, with most characters hidden. The same file can be edited by hand:

```json
{
  "api_base_url": "http://127.0.0.1:8080",
  "api_key": "replace-with-a-long-random-key",
  "prompt_storage": "default",
  "telemetry_oss": "off"
}
```

For one shell, and only when the config file has no `api_base_url`, export the variables below. They disappear when the shell exits.

bash:

```bash
export GIT_AI_API_BASE_URL=http://127.0.0.1:8080
export GIT_AI_API_KEY=replace-with-a-long-random-key
```

PowerShell:

```powershell
$env:GIT_AI_API_BASE_URL = "http://127.0.0.1:8080"
$env:GIT_AI_API_KEY = "replace-with-a-long-random-key"
```

During `git-ai install-hooks`, the installer also saves `API_BASE` and `API_KEY` from the environment into this file when those variables are set. Those install-time names do not have the `GIT_AI_` prefix. An already installed CLI can skip another install-hooks run; `git ai config set` writes the same file.

Prompt upload follows `prompt_storage`:

| Value | What the CLI does with prompts |
| --- | --- |
| `default` | Uploads prompts to CAS (`POST /worker/cas/upload`) and strips them from the git note |
| `notes` | Keeps prompts in the git note |
| `local` | Keeps prompts in the CLI's local database and does not upload them |

`default` is the CLI default. With an API key set and no `notes_backend` of its own, the CLI also posts authorship notes to the API base URL, so those notes land in this collector.

`telemetry_oss` set to `off` stops the CLI from sending error telemetry to Git AI's vendors. This collector does not receive that telemetry.

After the CLI is pointed here, commits and agent checkpoints upload metrics to `POST /worker/metrics/upload`, prompts (when `prompt_storage` is `default`) to `POST /worker/cas/upload`, authorship notes to `POST /worker/notes/upload`, and daemon diagnostics to `POST /worker/logs/upload`. `POST /api/bundles` stores a JSON bundle and returns a URL for `GET /api/bundles/:id`.
