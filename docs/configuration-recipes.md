# Git AI CLI: готові конфігурації

[← README](../README.md) · [Потоки даних](data-flow.md) · [Безпека та експлуатація](security-and-operations.md)

Це **практичні рецепти для Git AI CLI на машині розробника**, а не конфігурація самого Collector. Використано **PowerShell** і синтаксис `git ai config`, підтверджений [офіційною документацією](https://usegitai.com/docs/get-started/configuration). Налаштування зберігаються **глобально для користувача** у `%USERPROFILE%\.git-ai\config.json` (Linux/macOS: `~/.git-ai/config.json`).

**Підстановка:** `https://collector.example.com` замініть реальною HTTPS-адресою. Для локального тесту використовуйте `http://127.0.0.1:8080`. При запуску в іншій машині HTTP без TLS заборонений — [чому](security-and-operations.md#1-https-для-collector).

## Перед початком: перевірити стан

```powershell
git ai --version
git ai config                 # поточна ефективна конфігурація
git ai config notes_backend.kind
git ai config prompt_storage
git ai config telemetry_oss
```

Якщо CLI працював під обліковим записом Git AI, перевірте наявність **login token** (наприклад, у `git ai debug`, якщо команда підтримується вашою версією). `git ai config unset api_key` **не видаляє** активний login token і не скидає `GIT_AI_API_KEY` зі змінних середовища.

### Спільна вимога для всіх 4 сценаріїв: не надсилати OSS telemetry постачальнику

```powershell
git ai config set telemetry_oss off
git ai config unset telemetry_enterprise_dsn
git ai config set disable_version_checks true
git ai config set disable_auto_updates true
```

- `telemetry_oss=off` вимикає OSS error/performance telemetry у Sentry/PostHog Git AI.
- `disable_version_checks=true` вимикає автоматичні перевірки версій під час Git операцій.
- `disable_auto_updates=true` вимикає автоматичне встановлення оновлень. **Сам по собі цей параметр не вимикає version checks**, тому потрібні обидва.
- `telemetry_enterprise_dsn` скидаємо, щоб не залишалося додаткового Sentry destination. Це може бути **ваш** DSN, не обов'язково сервіс Git AI.
- Налаштування **не блокують** мережевий доступ редактора, AI-моделі, `git push`, інсталятора або іншого ПЗ. Повну перевірку egress роблять firewall/network logs.

Далі в **кожному рецепті** ці чотири команди повторено навмисно, щоб блок можна було запускати окремо.

---

## Сценарій 1 — повністю вимкнути збір Git AI

**Мета:** припинити нові checkpoints, notes та uploads, а також vendor telemetry. Уже зібрані локальні записи/старі Git Notes автоматично не стираються.

```powershell
# 1. Відключити передачу зовнішньої OSS telemetry й autoupdates
git ai config set telemetry_oss off
git ai config unset telemetry_enterprise_dsn
git ai config set disable_version_checks true
git ai config set disable_auto_updates true

# 2. Вимкнути обробку всіх репозиторіїв ("*" — підтримуваний glob)
git ai config set exclude_repositories "*"

# 3. Вимкнути основні потоки даних
git ai config set prompt_storage local
git ai config set feature_flags.transcript_streaming false
git ai config set feature_flags.transcript_sweep false
git ai config set feature_flags.token_usage_metrics false
git ai config set feature_flags.daemon_log_upload false

# 4. Прибрати CLI API key і змінну поточної PowerShell-сесії
git ai config unset api_key
Remove-Item Env:GIT_AI_API_KEY -ErrorAction SilentlyContinue

# 5. Не залишати маршруту до hosted API, навіть якщо з'явиться credential
git ai config set api_base_url http://127.0.0.1:8080
git ai config set notes_backend.kind git_notes

# 6. Видалити інтеграційні hooks, які встановив Git AI
git ai uninstall-hooks

# 7. Перевірка
git ai config
```

**Важливо:** це найближчий підтримуваний набір до «все вимкнено», а не один master switch. Власні hooks, IDE extensions або запущений раніше daemon можуть потребувати окремого перезапуску/видалення. Якщо CLI був залогінений — відключіть/видаліть login credentials штатним способом вашої версії; сам `unset api_key` цього не гарантує. `git ai config` може показувати default значення, які більше не використовуються через `exclude_repositories` та відсутні hooks.

**Не видаляйте** `~/.git-ai`, `.git/ai` чи `refs/notes/ai` автоматично: це може бути історія інших проєктів. Очищення — окрема контрольована процедура.

---

## Сценарій 2 — максимум у Git Notes, без Collector

**Мета:** зберігати authorship і, за можливості CLI, текст промптів у `refs/notes/ai`; **не** відправляти метрики, CAS, логи чи transcripts до HTTP Collector / Git AI hosted service.

```powershell
# 1. Без vendor telemetry
git ai config set telemetry_oss off
git ai config unset telemetry_enterprise_dsn
git ai config set disable_version_checks true
git ai config set disable_auto_updates true

# 2. Знову дозволити обробку репозиторіїв
git ai config unset exclude_repositories
git ai config unset allow_repositories

# 3. Notes тільки в Git; промпти — в note (не CAS)
git ai config set notes_backend.kind git_notes
git ai config set prompt_storage notes

# 4. Відключити всі додаткові HTTP telemetry потоки
git ai config set feature_flags.transcript_streaming false
git ai config set feature_flags.transcript_sweep false
git ai config set feature_flags.token_usage_metrics false
git ai config set feature_flags.daemon_log_upload false

# 5. Уникнути автоматичних uploads через ключ / hosted login
git ai config unset api_key
Remove-Item Env:GIT_AI_API_KEY -ErrorAction SilentlyContinue
git ai config set api_base_url http://127.0.0.1:8080

# 6. Інтеграція з IDE/AI-агентами
git ai install-hooks
git ai config
```

Після нового AI-редагування й commit у відповідному repo перевірте:

```powershell
git log -1 --show-notes=ai
git notes --ref=ai list
git ai stats HEAD --json
```

**Необхідні уточнення:**

1. `prompt_storage=notes` **може зберігати чутливий текст у доступному читачам repository ref**. У версіях/інтеграціях Git AI бували проблеми із повнотою prompt messages; перевіряйте практично, чи вони справді присутні.
2. `git push` може синхронізувати `refs/notes/ai`; **не плутайте «немає HTTP Collector» з «дані нікуди не передаються»** — ваш SCM теж може бути хмарним.
3. Локальні metrics/checkpoints можуть продовжувати створюватися для технічної роботи CLI. Цей сценарій означає **Git Notes як єдине спільне сховище**, не абсолютну відсутність локального стану.
4. Якщо раніше ви використовували Collector, у ньому залишаться старі записи; зміна CLI не видаляє історичні дані.

Якщо **не хочете записувати текст промптів у Git**, замініть тільки один параметр:

```powershell
git ai config set prompt_storage local
```

---

## Сценарій 3 — лише Collector, без нових AI Notes у Git

**Мета:** authorship notes, metrics, tokens/cost, prompts/transcripts і daemon diagnostics (максимально підтримуваний склад) надсилати у **власний Collector**, не створюючи нові `refs/notes/ai` для цих commits.

```powershell
# 1. Без передачі OSS telemetry до Git AI vendor
git ai config set telemetry_oss off
git ai config unset telemetry_enterprise_dsn
git ai config set disable_version_checks true
git ai config set disable_auto_updates true

# 2. Дозволити всі репозиторії (або нижче налаштуйте whitelist)
git ai config unset exclude_repositories
git ai config unset allow_repositories

# 3. Authorship notes -> HTTP backend
git ai config set notes_backend.kind http
git ai config set notes_backend.backend_url https://collector.example.com

# 4. Інші upload-потоки -> той самий Collector
git ai config set api_base_url https://collector.example.com
git ai config set prompt_storage default

# 5. Максимум usage/diagnostics (підтримка залежить від версії CLI)
git ai config set feature_flags.transcript_streaming true
git ai config set feature_flags.transcript_sweep true
git ai config set feature_flags.token_usage_metrics true
git ai config set feature_flags.daemon_log_upload true

# 6. Ключ для поточної сесії PowerShell (не комітьте його в repo)
$env:GIT_AI_API_KEY = Read-Host 'Collector API key'

# 7. Hooks + перевірка
git ai install-hooks
git ai config
```

API key повинен приймати саме **ваш Collector**. CLI надсилає `X-API-Key` у запитах. Для production використовуйте безпечне керування secrets і належне TLS-з'єднання.

**Важливо:** нові attribution notes у цьому режимі надсилаються на Collector; **старі** `refs/notes/ai` у локальному/remote Git не видаляються самі. Локальні `.git/ai/working_logs/`, metrics DB та notes cache теж залишаються. `git ai notes migrate` може копіювати старі notes у Collector — застосовуйте тільки після backup/перевірки підтримуваного синтаксису.

### Варіант 3A — рекомендований privacy-first Collector

Якщо для AI Usage потрібні лише attribution, метрики commit/checkpoint, tokens і estimated cost, але не потрібні тексти розмов:

```powershell
git ai config set prompt_storage local
git ai config set feature_flags.transcript_streaming false
git ai config set feature_flags.transcript_sweep false
# За потреби можна вимкнути й daemon logs:
git ai config set feature_flags.daemon_log_upload false
```

**Увага:** навіть після вимкнення transcripts деякі `committed` events можуть містити diff hunks / serialized authorship note; `otel_trace` також може містити атрибути. Тому для високих вимог до privacy потрібна серверна фільтрація payload і перевірка мережевого трафіку, а не тільки ці прапорці.

---

## Сценарій 4 — максимум у Git Notes, решта в Collector

**Мета:** authorship notes **і, за налаштуванням, промпти** — у Git Notes; **метрики, токени/cost, transcript events, logs** — у власний Collector. Це змішаний режим, **не** дублювання notes через два backends.

```powershell
# 1. Без Git AI vendor telemetry
git ai config set telemetry_oss off
git ai config unset telemetry_enterprise_dsn
git ai config set disable_version_checks true
git ai config set disable_auto_updates true

# 2. Дозволити репозиторії
git ai config unset exclude_repositories
git ai config unset allow_repositories

# 3. Notes + prompts -> Git repo
git ai config set notes_backend.kind git_notes
git ai config set prompt_storage notes

# 4. Metrics / tokens / transcripts / logs -> власний Collector
git ai config set api_base_url https://collector.example.com
git ai config set feature_flags.transcript_streaming true
git ai config set feature_flags.transcript_sweep true
git ai config set feature_flags.token_usage_metrics true
git ai config set feature_flags.daemon_log_upload true
$env:GIT_AI_API_KEY = Read-Host 'Collector API key'

# 5. Hooks та контроль
git ai install-hooks
git ai config
```

**Два нюанси цього режиму:**

- **Метрики Collector можуть містити authorship note і diff hunks** у payload `committed`; отже твердження «author attribution тільки в Git і фізично відсутній у Collector» без додаткової фільтрації **неправильне**.
- `prompt_storage=notes` переносить prompt text у Git notes, якщо інтеграція підтримує це; водночас увімкнені `transcript_streaming`/`transcript_sweep` можуть незалежно передавати текст розмов на Collector у `session_event`. Якщо хочете **промпти лише в Git**, вимкніть обидва transcript flags і перевірте на реальному payload.

---

## Порівняння чотирьох сценаріїв

| Потік | 1. Вимкнено | 2. Тільки Notes | 3. Тільки Collector | 4. Notes + Collector |
| --- | --- | --- | --- | --- |
| Новий line attribution | Ні (зупинено hooks/фільтр) | Git Notes | Collector HTTP notes | Git Notes |
| Prompts | Немає нового збору Git AI | Git Notes (`notes`) | Collector CAS (`default`) | Git Notes (`notes`) + потенційно transcripts у Collector |
| Token/cost events | Вимкнені | Вимкнені | Collector | Collector |
| Transcript events | Вимкнені | Вимкнені | Collector | Collector |
| Daemon logs | Вимкнені | Вимкнені | Collector | Collector |
| Vendor Sentry/PostHog | Вимкнено | Вимкнено | Вимкнено | Вимкнено |
| Локальні історичні дані | Можуть залишитися | Так | Так | Так |

Таблиця описує **цільову конфігурацію**, а не гарантію відсутності всіх побічних полів у payload. [Детально про дані](data-flow.md).

## Фільтрація за репозиторіями

Конфігурація `notes_backend`, `prompt_storage`, `api_base_url` — **глобальна для користувача**, а не per-repository. **Не підтримується:** repo A → Git Notes, repo B → Collector в одному профілі/daemon.

Але можна вказувати, **для яких репозиторіїв Git AI взагалі працює**:

```powershell
# Тільки репозиторії в організації (приклад шаблону URL)
git ai config set allow_repositories "https://github.com/example-org/*"

# Виключити один repo (виконуйте в каталозі цього repo)
git ai config set exclude_repositories .

# Додати другий repo до виключень, не стираючи перший
git ai config --add exclude_repositories "https://github.com/example-org/sensitive-repo"

# Вилучити повне обмеження, коли воно вже не потрібне
git ai config unset allow_repositories
git ai config unset exclude_repositories
```

Для промптів є окремі масиви: `include_prompts_in_repositories` та `exclude_prompts_in_repositories`. Вони впливають на **prompt text**, але не змінюють destination authorship notes. Якщо repo і дозволено, і виключено, **виключення має пріоритет**. Перед використанням корпоративного whitelist перевірте нормалізацію SSH/HTTPS remote URLs і поведінку для repo **без remote**.

## Після будь-якої зміни: як перевірити

```powershell
# Переглянути поточні значення
git ai config

# Перевірити поточний remote та notes
 git remote -v
 git log -1 --show-notes=ai
 git notes --ref=ai list

# Перевірити attribution для локального commit
 git ai stats HEAD --json

# Подивитися, чи є notes у remote (приклад origin)
 git ls-remote origin refs/notes/ai
```

Для HTTP-mode робіть тест на **новому невеликому репозиторії без історичних notes**, перевіряйте надходження запитів у Collector і **фактичний payload**. Відсутність нового `refs/notes/ai` у Git не доводить, що всі дані успішно дійшли до Collector. Перезапустіть редактор і daemon після зміни конфігурації, якщо вони могли залишити старі налаштування в пам'яті; точна команда керування daemon залежить від версії CLI.

## Про використання API key

`GIT_AI_API_KEY` у прикладах живе **лише в поточній PowerShell-сесії**. Нова сесія не успадковує її автоматично. **Уже запущений daemon також може не успадкувати** змінну, додану після його запуску; перезапустіть daemon згідно з можливостями вашої версії CLI й повторно перевірте ingestion. Для корпоративного rollout зберігайте credential у секретному сховищі/MDM, мінімізуйте scope, налаштуйте rotation та індивідуальну ідентифікацію інсталяцій. **Не** вставляйте реальний ключ у `README`, Git, чат або загальнодоступний shell script.

[← До README](../README.md) · [Далі: Security & Operations](security-and-operations.md)
