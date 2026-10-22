# API читання та ключі

[← README](../README.md)

Collector пов'язує запис із `id` ключа, який прийняв upload. Git author, `X-Distinct-ID` і `X-Author-Identity` залишаються даними події, але не є межею доступу: клієнт може їх змінити.

## Конфігурація ключів

Задайте `KEYS_FILE` на JSON-файл і перезапустіть Collector:

```json
{
  "keys": [
    { "id": "ada", "secret": "write-secret", "write": true, "read": ["ada"] },
    { "id": "analytics", "secret": "read-secret", "write": false, "read": "*" }
  ]
}
```

`write: true` дозволяє CLI upload на наявні `/worker/*` і `POST /api/bundles`. `write: false` отримує `403` на upload. `read` визначає дані, які ключ може читати: власний id, список id або `"*"`. Порожній список не дає читання.

Якщо `KEYS_FILE` задано, `API_KEYS` і `BEARER_TOKENS` ігноруються. Без файлу вони сумісні зі старою конфігурацією: кожен секрет має id `legacy-api-N` або `legacy-bearer-N`, право запису та читання тільки власних рядків.

`npm run dev` і `npm start` підставляють ці змінні з `.env` у поточній теці, якщо їх ще немає в середовищі процесу.

## Маршрути

Усі `GET /api/v1/*` вимагають ключ із непорожнім `read`.

- `/api/v1/access` повертає id поточного ключа і його scope без секрету.
- `/api/v1/metrics` повертає події, включно з `credential_id`, `repo_url`, `repo_key`, `branch`, git-атрибутами та сирим event.
- `/api/v1/token-usage` повертає token buckets із тими самими основними розрізами.
- `/api/v1/prompts` повертає CAS hash, content, metadata та repo/branch, лише якщо вони були рядками в metadata upload.
- `/api/v1/notes` повертає commit, content і `credential_id`; notes не мають repo/branch у протоколі upload.

Спільні параметри: `key`, `repo`, `branch`, `from`, `to`, `limit`, `cursor`; `metrics` також приймає `event`. `repo` порівнюється з нормалізованим `repo_key`, тому `git@github.com:org/repo.git` і `https://github.com/org/repo` збігаються. Типовий `limit` — 100, максимум — 1000. `cursor` — внутрішній id останнього рядка відповіді.

```powershell
curl.exe -H "X-API-Key: read-secret" `
  "https://collector.example.com/api/v1/metrics?repo=https://github.com/org/repo&branch=main&limit=100"
```

Параметр `key` не розширює доступ: id поза scope повертає `403`. Без нього відповідь тихо обмежується scope ключа. Старі рядки без `credential_id` доступні лише ключу з `read: "*"`.

CLI-маршрути `GET /worker/cas`, `GET /worker/notes` і `GET /api/bundles/:id` застосовують той самий scope.
