# Як Git AI збирає та передає дані

[← README](../README.md) · [Практичні конфігурації](configuration-recipes.md) · [Безпека та експлуатація](security-and-operations.md)

## 1. Основна ідея

Git AI CLI — локальний інструмент, що фіксує авторство змін у коді та супутні події використання AI. **Collector** — окремий HTTP-сервіс, який приймає вибрані потоки. Це **різні ролі**: Collector сам не перехоплює редагування в Cursor і не розраховує attribution з нуля.

```text
AI tool ---> hook / IDE extension ---> git ai checkpoint
                                            |
                                            v
                                  .git/ai/working_logs/
                                            |
                                          commit
                                            |
                                            v
                                      authorship note
                                       /          \
                            git_notes /            \ http
                                     v              v
                               refs/notes/ai      Collector
                                     |
                             git push / fetch

Одночасно: git-ai daemon ---> локальна metrics-db ---> /worker/metrics/upload
                       \---> CAS queue ------------> /worker/cas/upload
                       \---> daemon logs ----------> /worker/logs/upload
```

**Hook не дорівнює HTTP POST.** Hook відмічає зміну локально. Daemon відправляє події окремо у фоновому циклі (за аналізом Cursor — приблизно через 3 секунди після завершення попереднього циклу). Поведінка залежить від версії CLI, наявності API key / login token та конфігурації.

## 2. Що конкретно вимірюється

| Категорія | Приклади полів/змісту | Обмеження |
| --- | --- | --- |
| **Line attribution** | Файли, діапазони рядків, AI tool, модель, сесія, пов'язаний Git-автор | Не кожен рядок можна впевнено віднести до AI або людини. |
| **Known-human attribution** | Рядки, які IDE безпосередньо зафіксувала як набрані людиною | Це не те саме, що всі рядки «не AI». |
| **Prompts** | Текст запиту до агента; за відповідного режиму — частина розмови | Може містити комерційну таємницю, код або секрети. |
| **Session events / transcripts** | Повідомлення, responses, tool/MCP calls, помилки, часові мітки | Незалежний канал від `prompt_storage`; дуже чутливі дані. |
| **Tokens / cost** | Input/output/cache/reasoning tokens, модель, estimated cost | Cost — локальна оцінка за pricing catalog, **не інвойс**. |
| **Commit/checkpoint metrics** | Число змінених рядків, breakdown за tool/model, commit SHA, файли | Може містити note, diff hunks та інші фрагменти, близькі до коду. |
| **Daemon diagnostics** | Heartbeat, технічні логи, помилки daemon | Не всі логи гарантовано доставляються після збоїв. |
| **OSS telemetry** | Crash, error/performance events Git AI CLI | Це **інший** канал до Sentry/PostHog постачальника, не ваш Collector. |
| **Identity/metadata** | Git author/email, repo remote, branch, commit, install ID, session ID | Git email — ознака attribution, а не підтверджена особа. |

У форматі authorship `authorship/3.0.0` сесії та attribution можуть зберігатися без повного тексту повідомлень. Тому твердження «зберігаю notes — отже зберігаю всі transcripts» неправильне. Якщо `prompt_storage=notes`, поведінку для конкретної версії та AI-інструмента перевіряйте окремо: повнота тексту промптів не гарантується.

## 3. Типи metric events

За аналізом Cursor і прикладами Git AI телеметрії:

| ID | Назва | Що означає |
| --- | --- | --- |
| 1 | `committed` | Статистика AI/людських змін у commit; може містити authorship note і diff hunks. |
| 2 | `agent_usage` | Активність AI-агента/сесії, інколи поза Git repository. |
| 3 | `install_hooks` | Спроби інсталяції та стан інтеграцій. |
| 4 | `checkpoint` | Зміни файлів під час checkpoint. |
| 5 | `session_event` | Подія з transcript (включно з текстовими payload). |
| 6 | `otel_trace` | OpenTelemetry spans, атрибути й часові дані. |
| 7 | `rewrite_committed` | Зміни attribution після rebase/amend тощо. |
| 8 | `daemon_ingest_anomaly` | Діагностика проблем збору або обробки. |
| 9 | `token_usage` | Токени та оціночна вартість. |

Схема компактного event використовує `t` (timestamp), `e` (event type), `v` (значення), `a` (attributes); типові виміри — repository, author, commit, branch, tool, model, session. Числові позиції полів можуть змінюватися з версією CLI. [Офіційні приклади](https://github.com/git-ai-project/git-ai/blob/main/docs/telemetry-examples.md).

## 4. Куди потрапляють дані

| Дані | Git Notes (`git_notes`) | Collector | Локальний комп'ютер |
| --- | --- | --- | --- |
| Authorship map (рядки / tool / model / session) | `refs/notes/ai` | `notes/upload` **лише в HTTP notes mode** | Working logs, а в HTTP-режимі також кеш notes. |
| Prompts | Якщо `prompt_storage=notes` | CAS, якщо `prompt_storage=default` | Якщо `prompt_storage=local`; в інших режимах можливі локальні буфери. |
| Transcript/session JSON | Не окремий Git Note event | `metrics/upload`, якщо потокові події ввімкнені | Agent transcript + metrics DB. |
| Tokens / estimated cost | Ні | `metrics/upload` | Metrics DB. |
| Checkpoint/commit metrics | Сам note містить attribution, **не metric event** | `metrics/upload` | Metrics DB. |
| Daemon logs | Ні | `logs/upload` | Буфер у пам'яті. |
| OSS crash/error telemetry | Ні | **Не до цього Collector** | Sentry/PostHog постачальника, якщо не вимкнути. |

### Важливе застереження щодо «Git Notes + Collector»

Перемикач `notes_backend` має **одне** призначення для notes: Git **або** HTTP. Однак `committed` metric event може переносити **serialized authorship note** і `diff hunks` через `metrics/upload`. Тому змішаний режим із Git Notes та метриками в Collector **не гарантує**, що authorship-контент узагалі не дублюється на Collector. Якщо потрібна строга ізоляція, потрібні аналіз і фільтрація payload, а не тільки перемикання `notes_backend`.

## 5. Як працює `prompt_storage`

| Значення | Поведінка |
| --- | --- |
| `local` | Промпти залишаються в локальній SQLite; не публікуються як CAS/в notes цим механізмом. |
| `notes` | Додаються до authorship note після redaction, за можливостями версії Git AI. Далі note йде в Git або HTTP. |
| `default` | Надсилаються окремо через `POST /worker/cas/upload`; note не містить самого transcript тексту. |

**Критично:** `prompt_storage=local` **не вимикає** `session_event` у `metrics/upload`. Для обмеження transcript payload потрібно також вимкнути `feature_flags.transcript_streaming` і `feature_flags.transcript_sweep`. Це окремі механізми. Детальні команди — [у рецептах](configuration-recipes.md).

## 6. Локальні дані й Git remote

- `.git/ai/working_logs/` — локальні checkpoints до commit; не звичайні tracked-файли Git.
- `~/.git-ai/internal/metrics-db` — локальна SQLite із metric events.
- `~/.git-ai/internal/notes-db` — кеш notes в HTTP mode.
- Додаткові CAS/prompt-черги й файли агента можуть залишатися локально.
- `refs/notes/ai` — окремий Git ref, який може синхронізуватися з remote. Доступ до repository/notes = потенційний доступ до attribution metadata.
- `refs/notes/ai-stash` — окремий ref для стану stash у Git AI, згідно з аналізом Cursor.

**Collector-only не означає «нічого локально».** Це означає, що **нові** authorship notes не додаються до `refs/notes/ai` через HTTP backend. Старі notes, створені до переключення режиму, **нікуди не зникають самі**.

## 7. Що відбувається під час недоступності Collector

Згідно з розбором конкретної реалізації Cursor (версієзалежна поведінка):

| Потік | Поведінка |
| --- | --- |
| Hooks/checkpoints | Працюють локально; збій Collector зазвичай не блокує Cursor. Але збій самого checkpoint може призвести до пропуску attribution. |
| Git commits / локальні notes | Зазвичай продовжують працювати незалежно від мережевого Collector. |
| Metric events | Спочатку SQLite, потім retry з backoff; після обмеженої кількості спроб частина записів може залишитися локально без автоматичного повторного upload. |
| HTTP notes | Зберігаються в локальному кеші й повторно надсилаються пізніше. |
| CAS prompts | Невдалий upload не гарантовано автоматично повториться; локальний запис може залишитися без доставки. |
| Daemon logs | Тимчасовий буфер у пам'яті; після виходу daemon частину логів можна втратити. |

В аналізі Cursor згадувалися ~3 секунди між flush, 30 секунд timeout запиту та retry метрик із затримками до 24 годин. **Це не SLA й не гарантована поведінка будь-якої версії CLI.** Для production перевіряйте версію, retry count, дедуплікацію, backpressure та можливість повторної обробки backlog. [Операційний checklist](security-and-operations.md#5-операційна-надійність).

## 8. А якщо немає API key?

За аналізом Cursor автоматичні uploads метрик, CAS та HTTP notes вимагають `api_key`, `GIT_AI_API_KEY` або login token. Сам `api_base_url` без credential **не означає**, що дані почнуть передаватися. Але локальний збір може тривати. Для режиму «тільки Git Notes» свідомо не задавайте token, не входьте в Git AI hosted account і відключіть vendor telemetry.

## Далі

- [Чотири готові режими налаштування](configuration-recipes.md).
- [HTTPS, secrets, privacy, AI Usage, retention](security-and-operations.md).

