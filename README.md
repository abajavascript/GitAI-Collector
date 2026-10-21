# GitAI Collector

**GitAI Collector** — власний HTTP ingestion backend для [Git AI CLI](https://github.com/git-ai-project/git-ai). Він приймає дані, які Git AI збирає під час роботи розробника з AI-інструментами (наприклад, Cursor, Claude Code або GitHub Copilot), щоб їх можна було зберігати й надалі використовувати для **AI Usage Analytics**.

Це **не AI-модель**, не заміна Git AI CLI і не готова BI-платформа. Collector — приймальний компонент; зіставлення з працівниками, проєктами, PR та побудова звітів є окремими задачами.

## Навіщо це потрібно

- Централізовано отримувати **AI authorship / line attribution**: які рядки коду приписано AI або людині.
- Збирати **AI usage**: активність агентів, checkpoint/commit metrics, моделі, токени та розрахункові витрати.
- За потреби отримувати **prompts, transcripts і daemon logs** — або свідомо вимикати ці чутливі потоки.
- Самостійно обирати, де зберігати дані: у **Git Notes**, у **власному Collector** або розподіляти різні категорії між ними.
- Не передавати службову OSS-телеметрію Git AI до Sentry/PostHog постачальника, вимкнувши її в CLI.

> **Важливо:** типи даних і маршрути описані для сумісності з Git AI CLI, розглянутої станом на **21.10.2026**. Перед production перевірте версію CLI й контракт саме вашої ревізії Collector.

## Як це працює

```text
Cursor / Claude Code / Copilot
          |
          v
   Git AI CLI + daemon
          |
          +---- authorship notes ----> refs/notes/ai (Git)  [режим git_notes]
          |                       або
          +---- authorship notes ----> власний Collector   [режим http]
          |
          +---- metrics / tokens / transcripts / logs ---> Collector (за налаштуваннями)

Git AI OSS error telemetry ---> Git AI vendor [ВИМКНУТИ: telemetry_oss=off]
```

**Git AI не робить HTTP-запит після кожного редагування файлу.** Hooks створюють локальні checkpoints; daemon пізніше відправляє накопичені дані. Відмова Collector зазвичай не блокує редагування або commit, але може призвести до затримки чи втрати окремих подій. [Деталі](docs/data-flow.md).

## Швидкий запуск Collector

Потрібні Git, Node.js та npm. Точні підтримувані версії Node.js і назви npm-скриптів необхідно звірити з `package.json` поточної ревізії.

```powershell
# Windows PowerShell
git clone https://github.com/abajavascript/GitAI-Collector.git
cd GitAI-Collector
if (Test-Path package-lock.json) { npm ci } else { npm install }
npm run  # переглянути наявні scripts у package.json
```

1. Якщо в репозиторії є `.env.example`, скопіюйте його в `.env` (`Copy-Item .env.example .env`) і вкажіть параметри, визначені в `src/config.ts` (порт, bind address, API key, storage та інші, якщо вони передбачені реалізацією). **Не додавайте `.env` і секрети в Git.**
2. Запустіть **наявний** у `package.json` скрипт. Нижче — PowerShell-команда, яка вибирає `dev` або `start`, не припускаючи, що конкретний скрипт існує:

```powershell
$scripts = (Get-Content package.json -Raw | ConvertFrom-Json).scripts
if ($scripts.dev) { npm run dev }
elseif ($scripts.start) { npm start }
else { throw 'Не знайдено scripts.dev або scripts.start; перевірте npm run' }
```

3. Для production використовуйте зібрану версію й процес-менеджер згідно зі scripts проєкту. За аналізом Cursor локальна адреса за замовчуванням — `http://127.0.0.1:8080`; перевірте її у `src/config.ts` своєї ревізії.

```powershell
# Перевірка, чи слухається локальний порт (це НЕ health-check API)
Test-NetConnection 127.0.0.1 -Port 8080
```

> **HTTP/HTTPS:** сам Fastify Collector, за аналізом Cursor, слухає HTTP без TLS. Для доступу з інших машин розмістіть перед ним Nginx/Caddy/Traefik із HTTPS, а HTTP-порт залиште приватним. **Не передавайте `X-API-Key`, промпти чи метрики незашифрованим HTTP через LAN/інтернет.** [Безпека й експлуатація](docs/security-and-operations.md).

## Підключення Git AI CLI: мінімальний приклад

Нижче — **Collector-only** конфігурація. Команди виконуються **на машині розробника** (PowerShell), а не на сервері Collector. URL та API key замініть своїми значеннями.

```powershell
git ai config set telemetry_oss off
git ai config set disable_version_checks true
git ai config set disable_auto_updates true
git ai config set notes_backend.kind http
git ai config set notes_backend.backend_url https://collector.example.com
git ai config set api_base_url https://collector.example.com
git ai config set prompt_storage local
# Без тексту промптів у CAS; окремо вимикаємо transcript events:
git ai config set feature_flags.transcript_streaming false
git ai config set feature_flags.transcript_sweep false

# Демонстраційно: поточна сесія PowerShell. Для production — secret manager.
$env:GIT_AI_API_KEY = Read-Host 'Collector API key'
git ai config
```

API key має відповідати налаштуванню авторизації **вашого Collector**. Саме `telemetry_oss=off` вимикає сторонню OSS error/performance telemetry; інші два прапорці прибирають автоматичні перевірки версій та оновлення, але не доводять повну відсутність будь-яких зовнішніх звернень (наприклад, до Git remote).

## Ключі та читання даних

Один `GIT_AI_API_KEY` залишається ключем, який розробник задає CLI. Він може бути персональним або командним; Collector відокремлює потоки за стабільним `id` ключа, а не за git author. Для production задайте `KEYS_FILE`: він містить секрет, право upload (`write`) і scope читання (`read`) кожного ключа. Старі `API_KEYS` та `BEARER_TOKENS` працюють, поки `KEYS_FILE` не заданий.

API читання, формати файлу ключів, параметри фільтрів і правила видимості описані в [docs/read-api.md](docs/read-api.md). Prompts у відповідях API — чутливий текст: видавайте read-доступ лише тим, кому він необхідний.

## Документація

| Файл | Що всередині |
| --- | --- |
| [docs/data-flow.md](docs/data-flow.md) | Потоки даних, Git Notes vs Collector, метрики, локальне зберігання, поведінка при збоях. |
| [docs/configuration-recipes.md](docs/configuration-recipes.md) | **Готові команди для 4 режимів:** нічого не збирати; тільки Git Notes; тільки Collector; максимум Git Notes + решта в Collector. Також per-repo filtering та перевірки. |
| [docs/security-and-operations.md](docs/security-and-operations.md) | HTTPS, privacy, вимкнення передачі до Git AI vendor, доступ, retention, операційні ризики та рекомендації для AI Usage. |
| [docs/read-api.md](docs/read-api.md) | Ключі, scope читання та HTTP API для метрик, token usage, prompts і notes. |

## API, які використовує CLI

| Маршрут | Призначення |
| --- | --- |
| `POST /worker/notes/upload` | Authorship notes у HTTP notes mode. |
| `POST /worker/cas/upload` | Окремі prompt/CAS-об'єкти (`prompt_storage=default`). |
| `POST /worker/metrics/upload` | Metrics, token usage, transcripts та інші події. |
| `POST /worker/logs/upload` | Логи daemon і heartbeat. |
| `POST /api/bundles` | Явне завантаження/публікація JSON bundle; не автоматичний hook upload. |

Це перелік із аналізу коду Collector у Cursor; формат payload, auth і response перевіряйте у `src/routes/*`, `src/store/*` і тестах актуальної ревізії. Не плутайте API цього open-source проєкту з керованою комерційною платформою Git AI.

## Перш ніж використовувати в компанії

Визначте дозволені репозиторії, юридичну підставу й згоду клієнта на збір даних, політику prompts/transcripts, зберігання та видалення, відображення Git identity у корпоративний employee ID і обмеження метрик. **AI-generated lines ≠ продуктивність розробника**. [Рекомендації для AI Usage](docs/security-and-operations.md#6-ai-usage-аналітика-що-реально-можна-вимірювати).

## Джерела

- [Git AI CLI — Configuration](https://usegitai.com/docs/get-started/configuration)
- [Git AI CLI — Reference](https://usegitai.com/docs/get-started/reference)
- [Git AI — How it works](https://usegitai.com/docs/get-started/how-git-ai-works)
- [Git AI — Telemetry examples](https://github.com/git-ai-project/git-ai/blob/main/docs/telemetry-examples.md)

