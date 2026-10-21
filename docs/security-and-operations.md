# Безпека, експлуатація та AI Usage Analytics

[← README](../README.md) · [Потоки даних](data-flow.md) · [Готові конфігурації](configuration-recipes.md)

Ця сторінка відокремлює **те, що Git AI CLI / Collector роблять зараз за аналізом Cursor**, від **того, що потрібно додати або перевірити для production**. Не слід вважати всі наведені рекомендації вже реалізованими у цьому Collector.

## 1. HTTPS для Collector

За аналізом Cursor, Collector використовує **Fastify без власного TLS listener**, локально — `127.0.0.1:8080` через HTTP. Водночас Git AI CLI підтримує і HTTP, і HTTPS, залежно від `api_base_url` та `notes_backend.backend_url`.

**Безпечне розміщення на окремому сервері:**

```text
Developer laptop
   | HTTPS (TLS): X-API-Key, notes, metrics, prompts...
   v
Reverse Proxy (Caddy / Nginx / Traefik), TCP 443
   | HTTP only over localhost / isolated private network
   v
GitAI Collector (127.0.0.1:8080)
```

Приклад **Caddyfile** (потрібні контроль над DNS/мережею і коректний TLS-сертифікат):

```caddyfile
collector.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

На CLI:

```powershell
git ai config set api_base_url https://collector.example.com
git ai config set notes_backend.kind http
git ai config set notes_backend.backend_url https://collector.example.com
```

Якщо в сервері використовується `PUBLIC_BASE_URL`, вказуйте на **зовнішню HTTPS-адресу**: `https://collector.example.com`. Це лише формування URL, **не ввімкнення TLS** на Fastify listener.

Перевірки:

```powershell
# Перевірка TLS/сертифіката; HTTP 404/405 на HEAD можливий і не означає збій TLS
curl.exe -Iv https://collector.example.com

# Для локального тесту на сервері Collector
Test-NetConnection 127.0.0.1 -Port 8080
```

**Не робіть:** `http://collector.example.com`, відкритий у мережу порт `8080`, ігнорування помилок сертифіката, передавання ключа або prompts у логах Reverse Proxy. Локальний HTTP на `127.0.0.1` прийнятний лише в межах одного host; HTTP між різними VM/контейнерами потребує окремої оцінки мережевої ізоляції.

## 2. Як гарантувати, що нічого не йде до Git AI vendor

У Git AI є **два різні поняття telemetry**:

1. **Дані до вашого Collector:** notes/metrics/CAS/logs — якщо налаштовано endpoint і credential.
2. **OSS telemetry Git AI:** crash/error/performance події до сервісів постачальника (Sentry/PostHog) — вимикаються окремо.

Базовий набір:

```powershell
# Не надсилати OSS diagnostics постачальнику
git ai config set telemetry_oss off

# Не спрямовувати diagnostics на додатковий Sentry DSN
git ai config unset telemetry_enterprise_dsn

# Усунути автоматичні зовнішні version/update запити
git ai config set disable_version_checks true
git ai config set disable_auto_updates true

# Направити штатні uploads до власного backend, а не default https://usegitai.com
git ai config set api_base_url https://collector.example.com

# Перевірити результат
git ai config
```

**Це необхідні налаштування, але не доказ нульового трафіку до Git AI vendor.** Додатково:

- Перевірте, що **не** використовується hosted login token, який спрямовує дані на vendor; перевіряйте також `GIT_AI_API_KEY` та `api_key`.
- Якщо ввімкнено HTTP notes backend, перевірте **також** `notes_backend.backend_url`. Він може відрізнятися від `api_base_url`.
- Подивіться DNS, HTTPS egress та журнали firewall/proxy в тестовій сесії з Cursor + `git ai checkpoint` + commit. Зафіксуйте очікувані дозволені destination domains.
- Окремо врахуйте трафік **самого AI-інструмента, SCM, npm/installer і системи оновлень**: Git AI config ним не керує.
- Високі вимоги до data residency забезпечуйте **network allowlist / deny by default**, а не тільки локальними налаштуваннями процесу.

[Всі чотири готові набори команд](configuration-recipes.md).

## 3. Data privacy: чому `prompt_storage=local` недостатньо

Промпти можуть потрапити на сервер щонайменше двома шляхами:

- Через CAS (`prompt_storage=default`).
- Усередині `session_event` у `metrics/upload`, якщо ввімкнені transcript streaming/sweep.

Мінімізація текстових даних для AI Usage:

```powershell
git ai config set prompt_storage local
git ai config set feature_flags.transcript_streaming false
git ai config set feature_flags.transcript_sweep false
```

Але **і це не повний DLP**: events типу `committed` можуть переносити serialized authorship note й diff hunks, а OpenTelemetry spans — довільні атрибути. Окремо є локальні транскрипти AI-агентів. Для дійсної заборони передачі контенту потрібні:

- Аналіз реальних request payload для **кожного** endpoint на конкретній версії CLI.
- Allowlist полів або редагування/редакція чутливих полів **до надсилання**, а не лише після прийому.
- Серверна валідація payload size, JSON schema та відхилення заборонених полів.
- Визначення політики для prompts, responses, file paths, diff hunks, tool/MCP arguments і raw OpenTelemetry attributes.

**Не вмикайте `prompt_storage=notes` у клієнтських Git-репозиторіях без дозволу:** тоді частина тексту розмов може потрапляти в Git Notes, доступні іншим користувачам SCM.

## 4. Ідентифікація, доступ і багатоклієнтська ізоляція

Git-автор не є надійним доказом особи: email/name можна змінити. Так само `X-Distinct-ID` — інсталяційний ідентифікатор, а не підтверджений corporate employee ID. `X-Author-Identity` та репозиторій можуть бути корисними dimensions, але не підставою для authorization.

У Collector межею доступу є `id` ключа, який прийняв запис. Write-ключ із `read` тільки на свій id **не** є ключем до всієї бази. Не використовуйте git author або URL репозиторію як authorization: це дані від клієнта. Ключ із `read: "*"` навмисно бачить також старі рядки без id ключа, тому його слід видавати лише адміністраторам/аналітиці. Prompts у read API — чутливий текст; обмежте read scope, TLS, журнали доступу й retention. Детальний формат — у [API читання та ключі](read-api.md).

**Для production варто визначити:**

| Питання | Рекомендація |
| --- | --- |
| Хто надсилає? | Унікальний write-only credential для конкретної інсталяції/клієнта; rotation/revocation. |
| Якому проєкту належить repo? | Нормалізований repository ID і керована mapping-таблиця, не тільки довільний URL. |
| Хто employee? | Корпоративний directory mapping зі списком alias/email; зберігати provenance й історію змін. |
| Чи має клієнт право передавати дані? | Окрема approval/authorization policy для кожного repo/project. |
| Чи можна змішувати клієнтів? | Логічна tenant isolation, tenant-bound credentials, access audit; ніколи не довіряти tenant ID у payload без перевірки. |
| Хто читає? | RBAC, audit trail, окремі права на aggregate metrics і raw transcripts/notes. |

**Обмеження Git AI:** `notes_backend`, `api_base_url` і `prompt_storage` — **глобальні** для користувача, а не per repo. `allow_repositories` / `exclude_repositories` та prompt filters лише включають або виключають репозиторії. В одному daemon штатно не можна задати repo A → Notes, repo B → Collector. Рішення: єдина політика, ізольовані середовища або доопрацювання CLI. [Команди фільтрації](configuration-recipes.md#фільтрація-за-репозиторіями).

## 5. Операційна надійність

За аналізом Cursor, Git AI спочатку пише локально, а daemon асинхронно робить uploads. Це зменшує вплив downtime Collector на IDE/Git, **але не дає exactly-once delivery**.

**Поведінка, встановлена в попередньому аналізі Cursor (перевіряти для своєї версії):**

- Metrics: SQLite + retry/backoff; після кількох невдалих спроб записи можуть лишитися без автоматичної доставки.
- HTTP authorship notes: локальне кешування та повторне надсилання.
- CAS prompts: невдалий upload може не потрапити назад у чергу автоматично.
- Logs: буфер обмежений пам'яттю daemon, можливі втрати після restart.
- HTTP request timeout: у розглянутій реалізації — приблизно 30 секунд, мережеві uploads відокремлені від звичайних checkpoints/commits.

**Production checklist (рекомендації, не підтверджені функції Collector):**

1. **Ідемпотентність**: визначити event ID / dedup key, надійно обробляти повторні POST і повторні commits/rebase.
2. **Durable ingestion**: обробляти payload через транзакцію або чергу, повертати успіх тільки після durable запису.
3. **Schema/version control**: зберігати raw payload + schema version, контролювати зміну numeric field positions.
4. **Моніторинг**: ingestion rate, error rate, reject reason, lag, last-seen-per-installation, backlog, end-to-end completeness.
5. **Recovery**: задокументувати backfill і ручне повторне завантаження без дублювання (особливо після максимального retry count).
6. **Retention/deletion**: строки для raw transcripts, prompts, metrics, auth logs, резервних копій та журналів доступу.
7. **Безпека API**: body-size/rate limits, authentication, TLS, redaction логів, key rotation, перевірки 4xx/5xx/partial success.
8. **Тести сумісності**: replay anonymized fixtures із потрібних версій CLI; контрактні тести кожного endpoint і auth header.
9. **Невизначеність**: відсутність подій не означає, що AI не використовувався — можуть бути збої hooks, неінструментовані редактори чи неповне покриття.

## 6. AI Usage-аналітика: що реально можна вимірювати

Collector — можливе джерело **сигналів активності AI у SDLC**, а не готова система вимірювання продуктивності.

| Метрика | Що вона показує | Типова пастка |
| --- | --- | --- |
| AI-affected / AI-attributed lines | Частку рядків з AI attribution серед спостережуваних змін | Lines ≠ value, quality або productivity; unknown ≠ human. |
| Active AI users | Скільки ідентифікованих людей мали спостережувані AI events | Без активної бази eligible users «adoption rate» некоректний. |
| Active repositories/projects | Де були події Git AI | Відсутність подій не доводить відсутність використання AI. |
| Token consumption | Оцінку токенів за tool/model/user/session | Не всі інструменти мають однакове покриття; session attribution може бути неточним. |
| Estimated cost | Розрахунок за model pricing і обсягом usage | Це не фінансові фактичні витрати; тарифи, кеш, знижки і credits можуть відрізнятися. |
| Accepted/shipped AI code | Чи потрапили AI-attributed зміни в commits / гілки | Commit ще не означає merged, deployed або корисний результат. |
| Usage by employee/team/client | Зрізи за directory/project mappings | Git identity, кілька email, мультипроєктність, погодження клієнта. |

### Запропонована мінімальна модель даних для аналітики

Це **рекомендація для downstream pipeline**, не обов'язково поточна схема БД Collector:

- `event_id`, `source`, `git_ai_version`, `schema_version`, `received_at`, `event_at`.
- `installation_id`, `employee_id` (після mapping), `git_author`, `organization_id`, `project_id`, `repository_id`.
- `commit_sha`, `branch`, `session_id`, `agent_tool`, `model`.
- `event_type`, `ai_lines`, `known_human_lines`, `unknown_lines`, `tokens_in`, `tokens_out`, `estimated_cost_usd`.
- `ingestion_status`, `payload_redaction_level`, `client_policy_id`.

**Окремі сутності потрібні для PR/review/deployment**, якщо маєте намір аналізувати SDLC impact: Git AI notes самі по собі не дають повної картини merge, code review чи production outcome. І не використовуйте агрегати як оцінку персональної продуктивності без контексту й перевірки якості даних.

## 7. Перевірки перед пілотом

| Перевірка | Очікуваний результат |
| --- | --- |
| `git ai config` після застосування рецепта | Правильні `notes_backend`, `api_base_url`, flags і `telemetry_oss=off`. |
| Тестовий commit у кожному режимі | Attribution з'являється **саме там**, де очікується. |
| Network capture / proxy logs | Немає небажаних звернень до Git AI vendor; до власного Collector — тільки HTTPS. |
| Audit payload `metrics/upload` | Немає недозволених prompts/transcripts/diff hunks/secret values. |
| Collector недоступний 5 хв / 1 год | IDE і commits продовжують працювати; встановлено реальну втрату/затримку й recovery. |
| Повторні uploads | Немає дубльованих фактів у downstream аналітиці. |
| Git remote / старі notes | Не плутаємо newly generated notes і refs, що залишились від старих налаштувань. |
| Mapping employee/project | Git emails/repo URLs узгоджено з довідниками, сумнівні відповідності позначені. |
| Data retention/security review | Узгоджено scope data collection, доступ, строк життя, client authorization. |

## 8. Що звірити безпосередньо у цьому репозиторії

Це repo-specific чеклист. Він потрібний, оскільки в доступному сеансі **вміст GitAI-Collector на GitHub не вдалося прочитати**; наведені вище потоки й API взято з попереднього аналізу Cursor, який переглядав локальні файли проєкту, та з офіційної документації Git AI CLI.

- `package.json`: `scripts`, `engines`, залежності, build/start/dev і testing.
- `src/index.ts`, `src/app.ts`, `src/config.ts`: bind address, port, TLS, env names, запуск і shutdown.
- `src/routes/{notes,cas,metrics,logs,bundles}.ts`: endpoint paths, schema, HTTP responses, partial errors, auth.
- `src/store/{types,positions,sqlite}.ts`: event mapping, storage schema, retention, обсяг raw data та migration.
- `test/*`: інтеграційні тести, error handling, auth, malformed/oversized requests.
- `.env.example` (якщо існує): змінні запуску й приклади без реальних секретів.

**Після звірки** цих файлів варто прибрати з README умовність щодо `npm run dev` і задокументувати один точний, перевірений спосіб локального запуску й health check.

## Посилання

- [Git AI Configuration](https://usegitai.com/docs/get-started/configuration)
- [Git AI CLI Reference](https://usegitai.com/docs/get-started/reference)
- [Git AI How it works](https://usegitai.com/docs/get-started/how-git-ai-works)
- [Git AI Telemetry examples](https://github.com/git-ai-project/git-ai/blob/main/docs/telemetry-examples.md)
- [Git AI authorship format 3.0.0](https://github.com/git-ai-project/git-ai/blob/main/specs/git_ai_standard_v3.0.0.md)

[← До README](../README.md) · [Готові конфігурації](configuration-recipes.md)
