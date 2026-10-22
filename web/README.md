# Дашборд читання Collector

Окремий Next.js застосунок у каталозі `web/`. Collector лишається в корені репозиторію (Fastify, `npm run dev`, порт `8080`). UI лише читає `GET /api/v1/*`. CLI як і раніше пише в Collector.

Контракт відповіді — [docs/read-api.md](../docs/read-api.md). Поля в `web/lib/types.ts` повторюють JSON цих маршрутів (`repo_key`, `input_tokens`, `cursor`) і не імпортують `src/store/types.ts`: там внутрішній camelCase.

Робочу теку Cursor залишайте коренем репозиторію, не каталогом `web/`.

## Запуск

Потрібен Node.js 22, як у корені.

```powershell
# Термінал 1, корінь репозиторію
npm run dev

# Термінал 2
Copy-Item web\.env.example web\.env
npm install --prefix web
npm run dev:web
```

Next слухає `http://127.0.0.1:3000`. Скрипт `dev:web` у кореневому `package.json` лише запускає `web`. Зовнішній доступ — reverse proxy на Next.js. Collector для UI лишається на localhost.

## Секрети

Браузер не викликає Collector і не бачить `X-API-Key`. Серверний клієнт `web/lib/collector.ts` ходить на `COLLECTOR_BASE_URL` (типово `http://127.0.0.1:8080`) з `COLLECTOR_READ_KEY`. Це ключ із правом `read`, як `analytics` у [docs/read-api.md](../docs/read-api.md). Не ставте перед ним префікс `NEXT_PUBLIC_` і не імпортуйте клієнт у client-компоненти.

`DASHBOARD_PASSWORD` необов'язковий. Якщо його задано, форма на `/login` ставить httpOnly cookie; секрет Collector у форму не вводиться. Якщо пароль порожній, процес слухає лише localhost і відхиляє запит із нелокальним `Host` або `X-Forwarded-Host`. За HTTPS-проксі передавайте `X-Forwarded-Proto: https`, щоб cookie була `Secure`.

## Екрани

Фільтри, які вже вміє API: `repo`, `branch`, `from`, `to`, `key`, `cursor`, а також `limit` (1–1000, типово 100). `from` і `to` — Unix-час у секундах.

- Доступ поточного ключа: `/`
- Token usage: `/token-usage`
- Metrics: `/metrics`
- Notes: `/notes` (repo, branch, from і to протокол notes не зберігає, тож вони цю таблицю не звужують)
- Prompts: `/prompts`, окремий екран. Текст промптів на перший дашборд не виводиться

## Межа підсумків

Суми токенів і оціночна вартість на екрані token usage рахуються **лише з рядків завантаженої сторінки** і так підписані. `limit` не більший за 1000, тому сума «за місяць» з цього клієнта на більшому обсязі буде неправдою. SQL-агрегати (`/api/v1/.../summary`) — наступний крок у Collector, не частина цього каркаса.

Оціночна вартість — це поле `est_cost_micro_usd`, не фактичні фінансові витрати. Що цими сигналами можна і не можна міряти, описано в [розділі 6 «AI Usage-аналітика»](../docs/security-and-operations.md#6-ai-usage-аналітика-що-реально-можна-вимірювати). Зіставлення з людьми, проєктами, PR і оцінка продуктивності сюди не входять.
