# Telegram Bot (Telegraf + Express, webhook-only)

Минимальный, продакшен-готовый телеграм-бот на TypeScript с Telegraf, работает только через webhook (без long polling). Включает Express, dotenv, healthcheck и graceful shutdown.

## Быстрый старт

1. Установка зависимостей:

```bash
npm i
```

2. Создайте `.env` по примеру `.env.example` и заполните значения:

```env
BOT_TOKEN=123:ABC
BOT_WEBHOOK_URL=https://your-domain.com
TELEGRAM_WEBHOOK_PATH=/telegram/webhook/your-random-secret-path
TELEGRAM_WEBHOOK_SECRET=your-strong-secret
WEB_APP_URL=https://your-mini-app-url
PORT=8080
AUTO_SET_WEBHOOK=true
API_BASE_URL=https://api.example.com
BOT_BACKEND_SECRET=your-backend-secret
AB_SPLIT_A=50
```

3. Локальный запуск (dev):

```bash
npm run dev
```

Сервер поднимется на `http://localhost:8080`. Для prod:

```bash
npm run build && npm start
```

## Webhook

- При `AUTO_SET_WEBHOOK=true` вебхук установится автоматически, если заполнены переменные: `BOT_TOKEN`, `BOT_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_PATH`, `TELEGRAM_WEBHOOK_SECRET`.
- Если переменных не хватает — в лог выводится готовая команда `curl`.

Пример ручной установки (замените токен и URL):

```bash
curl -sS -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/telegram/webhook/your-random-secret-path",
    "secret_token": "your-strong-secret",
    "drop_pending_updates": true,
    "allowed_updates": ["message","callback_query","chat_member","chat_join_request"]
  }'
```

## Проверка

- Healthcheck: `GET /healthz` → `{"status":"ok"}`
- Команда `/start` отправляет приветствие и кнопку открытия Mini App (если указан `WEB_APP_URL`).
- Команда `/help` показывает краткую справку.
- Аналитика: при `/start` отправляется событие `bot_start_shown` с A/B вариантом и payload.

## Монетизация: Telegram Stars

- Эндпоинт создания инвойса (защищён `BOT_BACKEND_SECRET`):

```http
POST /monetization/stars/invoice
X-API-Key: <BOT_BACKEND_SECRET>
Content-Type: application/json

{ "itemKey": "premium", "starCount": 100 }
```

Ответ:

```json
{ "url": "https://t.me/.../invoice?..." }
```

- Бот обрабатывает `pre_checkout_query` и события успешной оплаты. В payload инвойса передаются поля `{ itemKey, starCount }`. После успешной оплаты отправляется уведомление в ваш бэкенд `POST {API_BASE_URL}/api/monetization/stars/success` с заголовком `X-API-Key: BOT_BACKEND_SECRET`.

## BotFather (опционально)

- Чтобы кнопка Mini App была в меню чата, в BotFather настройте: Menu Button → Web App → укажите тот же `WEB_APP_URL`.

## Примечания

- Никакого polling, не используем `bot.launch()` — только `bot.webhookCallback()` в Express.
- Вебхук проверяет заголовок `X-Telegram-Bot-Api-Secret-Token` и сравнивает с `TELEGRAM_WEBHOOK_SECRET`.
- Лимит `express.json()` установлен на 256kb.
- Грейсфул-шатдаун: корректно закрывает HTTP сервер по SIGINT/SIGTERM.


