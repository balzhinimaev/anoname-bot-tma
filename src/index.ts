import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { Telegraf, Context, Markup } from 'telegraf';

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || '';
const TELEGRAM_WEBHOOK_PATH = process.env.TELEGRAM_WEBHOOK_PATH || '/telegram/webhook';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || '';
const AUTO_SET_WEBHOOK = (process.env.AUTO_SET_WEBHOOK || 'false').toLowerCase() === 'true';
const PORT = Number(process.env.PORT || 7777);
const API_BASE_URL = process.env.API_BASE_URL || '';
const BOT_BACKEND_SECRET = process.env.BOT_BACKEND_SECRET || '';
const AB_SPLIT_A = Math.max(0, Math.min(100, Number(process.env.AB_SPLIT_A ?? '50')));

if (!BOT_TOKEN) {
  console.error('[startup] BOT_TOKEN не задан. Укажите BOT_TOKEN в .env');
}

// Create bot instance (no bot.launch())
const bot = new Telegraf<Context>(BOT_TOKEN || '');

function fnv1aHash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function assignVariant(telegramId: number | string, ratioA: number): 'A' | 'B' {
  const idStr = String(telegramId ?? '0');
  const bucket = fnv1aHash32(idStr) % 100;
  return bucket < Math.round(ratioA) ? 'A' : 'B';
}

function appendQueryParam(baseUrl: string, key: string, value: string): string {
  if (!baseUrl) return baseUrl;
  const hasQuery = baseUrl.includes('?');
  const joiner = hasQuery ? '&' : '?';
  return `${baseUrl}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function parseStartPayload(payload?: string): { referralCode?: string; campaign?: string } {
  if (!payload) return {};
  const [codeRaw, campaignRaw] = payload.split('__');
  const referralCode = (codeRaw || '').trim() || undefined;
  const campaign = (campaignRaw || '').trim() || undefined;
  return { referralCode, campaign };
}

type AnalyticsEvent = {
  name: string;
  telegramId?: number | string;
  props?: Record<string, unknown>;
};

async function postJsonWithRetry(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 4000, maxRetries = 2): Promise<void> {
  const doAttempt = async (attempt: number): Promise<void> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok) return;
      if ([400, 401, 403].includes(response.status)) {
        console.warn(`[analytics] Неуспешный статус без ретраев: ${response.status}`);
        return;
      }
      if (attempt < maxRetries) {
        const backoffMs = 500 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
        return doAttempt(attempt + 1);
      }
      console.warn(`[analytics] Неуспешный статус после ретраев: ${response.status}`);
    } catch (err) {
      if (attempt < maxRetries) {
        const backoffMs = 500 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
        return doAttempt(attempt + 1);
      }
      console.error('[analytics] Ошибка отправки события:', err instanceof Error ? err.message : err);
    } finally {
      clearTimeout(timeout);
    }
  };
  await doAttempt(0);
}

async function postAnalyticsEvent(name: string, telegramId?: number | string, props?: Record<string, unknown>): Promise<void> {
  if (!API_BASE_URL || !BOT_BACKEND_SECRET) {
    // Тихо пропускаем, чтобы не засорять логи в dev
    return;
  }
  const endpoint = `${API_BASE_URL.replace(/\/+$/, '')}/api/analytics/bot-event`;
  const payload: AnalyticsEvent = { name, telegramId, props };
  try {
    await postJsonWithRetry(endpoint, payload, { 'X-API-Key': BOT_BACKEND_SECRET });
  } catch (err) {
    console.error('[analytics] Ошибка (после ретраев):', err instanceof Error ? err.message : err);
  }
}

async function notifyStarsPaymentSuccess(
  telegramId: number | string | undefined,
  itemKey: string | undefined,
  starCount: number | undefined,
  successfulPayment: any
): Promise<void> {
  if (!API_BASE_URL || !BOT_BACKEND_SECRET) {
    return;
  }
  const endpoint = `${API_BASE_URL.replace(/\/+$/, '')}/api/monetization/stars/success`;
  const body = {
    telegramId,
    itemKey,
    starCount,
    successfulPayment,
  };
  try {
    await postJsonWithRetry(endpoint, body, { 'X-API-Key': BOT_BACKEND_SECRET });
  } catch (err) {
    console.error('[payments] Ошибка уведомления об успешной оплате:', err instanceof Error ? err.message : err);
  }
}

// Commands
bot.start(async (ctx) => {
  const payload = ctx.startPayload;
  if (payload) {
    console.log(`[telegram] /start payload: ${payload}`);
  }

  const userId = ctx.from?.id;
  const variant = assignVariant(userId ?? '0', AB_SPLIT_A);
  const { referralCode, campaign } = parseStartPayload(payload);

  const text = 'Привет! Хочешь найти собеседника?\n' + (WEB_APP_URL ? ' Открой мини-приложение по кнопке ниже.' : ' URL мини-приложения не настроен.');
  if (WEB_APP_URL) {
    const urlWithExp = appendQueryParam(WEB_APP_URL, 'exp', variant);
    const urlWithParams = referralCode ? appendQueryParam(urlWithExp, 'ref', referralCode) : urlWithExp;
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.webApp('Открыть приложение', urlWithParams)
        // Markup.button.callback('Открыть (лог)', `tma_click:${variant}`),
      ],
    ]).reply_markup;
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
  } else {
    await ctx.reply(text);
  }

  // Fire-and-forget аналитика
  void postAnalyticsEvent('bot_start_shown', userId, {
    variant,
    startPayload: payload || null,
    referralCode,
    campaign,
  });
});

bot.help(async (ctx) => {
  await ctx.reply('Доступные команды:\n/start — приветствие и кнопка WebApp\n/help — эта справка');
});

// Basic text handler (echo-like)
bot.on('text', async (ctx) => {
  const messageText = ctx.message?.text ?? '';
  if (messageText.trim().length === 0) {
    return;
  }
  await ctx.reply(`Вы написали: ${messageText}`);
});

// Track explicit click on WebApp via callback button (optional UX event)
bot.action(/^tma_click:(A|B)$/ as unknown as RegExp, async (ctx) => {
  try {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    const variant = data && data.split(':')[1] === 'A' ? 'A' : 'B';
    const userId = ctx.from?.id;
    void postAnalyticsEvent('bot_webapp_open_click', userId, { variant });
    await ctx.answerCbQuery('Записал');
  } catch (err) {
    console.error('[analytics] Ошибка при обработке tma_click:', err instanceof Error ? err.message : err);
    try { await ctx.answerCbQuery(); } catch {}
  }
});

// Callback query ack (fallback for other callbacks)
bot.on('callback_query', async (ctx) => {
  try {
    await ctx.answerCbQuery('Принято');
  } catch (err) {
    console.error('[callback_query] Ошибка при ответе на callback:', err instanceof Error ? err.message : err);
  }
});

// Payments: approve pre-checkout queries to allow payment
bot.on('pre_checkout_query', async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error('[payments] Ошибка при ответе на pre_checkout_query:', err instanceof Error ? err.message : err);
  }
});

// Payments: handle successful payments (including Stars)
bot.on('message', async (ctx) => {
  const msg: any = ctx.message as any;
  const sp = msg?.successful_payment;
  if (!sp) return;

  const payloadRaw: string | undefined = sp.invoice_payload;
  let payloadParsed: any = undefined;
  try {
    payloadParsed = payloadRaw ? JSON.parse(payloadRaw) : undefined;
  } catch {
    payloadParsed = undefined;
  }

  const itemKey: string | undefined = payloadParsed?.itemKey;
  const starCount: number | undefined = payloadParsed?.starCount;
  const telegramId = ctx.from?.id;

  console.log('[payments] Успешная оплата', {
    telegramId,
    currency: sp.currency,
    total_amount: sp.total_amount,
    itemKey,
    starCount,
    telegram_payment_charge_id: sp.telegram_payment_charge_id,
    provider_payment_charge_id: sp.provider_payment_charge_id,
  });

  // Fire-and-forget уведомление для бэкенда об активации подписки
  void notifyStarsPaymentSuccess(telegramId, itemKey, starCount, sp);

  try {
    await ctx.reply('Оплата получена! Спасибо.');
  } catch {}
});

// Centralized bot error handler
bot.catch((err, ctx) => {
  console.error('[telegraf] Ошибка в обработчике:', err instanceof Error ? err.message : err, 'ctx.updateType=', ctx.updateType);
});

// Express app
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));

// Health endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Middleware to verify Telegram secret token on webhook path
function verifyTelegramSecret(req: Request, res: Response, next: NextFunction) {
  const headerSecret = req.header('X-Telegram-Bot-Api-Secret-Token');
  if (!TELEGRAM_WEBHOOK_SECRET) {
    console.warn('[webhook] TELEGRAM_WEBHOOK_SECRET не задан, проверка заголовка пропущена');
    return next();
  }
  if (!headerSecret || headerSecret !== TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send('Unauthorized');
  }
  return next();
}

// Middleware to protect internal backend endpoints with BOT_BACKEND_SECRET
function requireBackendSecret(req: Request, res: Response, next: NextFunction) {
  if (!BOT_BACKEND_SECRET) {
    console.warn('[backend] BOT_BACKEND_SECRET не задан — запрос отклонён');
    return res.status(503).json({ error: 'Not configured' });
  }
  const apiKey = req.header('X-API-Key') || req.header('x-api-key');
  if (!apiKey || apiKey !== BOT_BACKEND_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

// Create Telegram Stars invoice link
app.post('/monetization/stars/invoice', requireBackendSecret, async (req: Request, res: Response) => {
  try {
    if (!BOT_TOKEN) {
      return res.status(503).json({ error: 'BOT_TOKEN not configured' });
    }
    const { itemKey, starCount } = req.body || {};
    if (itemKey !== 'premium') {
      return res.status(400).json({ error: 'Unsupported itemKey' });
    }
    const stars = Number(starCount);
    if (!Number.isInteger(stars) || stars <= 0) {
      return res.status(400).json({ error: 'Invalid starCount' });
    }

    const payload = {
      t: 'stars',
      itemKey,
      starCount: stars,
      v: 1,
      ts: Date.now(),
    };

    const title = 'Premium подписка';
    const description = 'Доступ к Premium функциям.';
    const prices = [{ label: 'Premium', amount: stars }];

    let url: string;
    try {
      url = await (bot.telegram as any).createInvoiceLink({
        title,
        description,
        payload: JSON.stringify(payload),
        currency: 'XTR',
        prices,
      });
    } catch (err) {
      console.error('[payments] Ошибка создания инвойса:', err instanceof Error ? err.message : err);
      return res.status(502).json({ error: 'Failed to create invoice' });
    }

    return res.status(200).json({ url });
  } catch (err) {
    console.error('[payments] Внутренняя ошибка при создании инвойса:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Webhook endpoint
app.post(TELEGRAM_WEBHOOK_PATH, verifyTelegramSecret, (req: Request, res: Response) => {
  return bot.webhookCallback(TELEGRAM_WEBHOOK_PATH)(req, res);
});

// Auto set webhook on startup if configured
async function ensureWebhook() {
  if (!AUTO_SET_WEBHOOK) {
    console.log('[startup] AUTO_SET_WEBHOOK=false — пропускаю установку вебхука');
    return;
  }
  if (!BOT_TOKEN || !BOT_WEBHOOK_URL || !TELEGRAM_WEBHOOK_PATH || !TELEGRAM_WEBHOOK_SECRET) {
    console.warn('[startup] Недостаточно переменных окружения для автоматической установки вебхука.');
    const fullUrl = `${BOT_WEBHOOK_URL || 'https://your-domain.com'}${TELEGRAM_WEBHOOK_PATH || '/telegram/webhook/your-path'}`;
    console.warn('Вы можете установить вебхук вручную через curl:');
    console.warn(
      `curl -sS -X POST https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook ` +
      `-H "Content-Type: application/json" ` +
      `-d '{"url":"${fullUrl}","secret_token":"${TELEGRAM_WEBHOOK_SECRET || 'your-strong-secret'}","drop_pending_updates":true,"allowed_updates":["message","callback_query","chat_member","chat_join_request","pre_checkout_query"]}'`
    );
    return;
  }

  const url = `${BOT_WEBHOOK_URL}${TELEGRAM_WEBHOOK_PATH}`;
  try {
    await bot.telegram.setWebhook(url, {
      secret_token: TELEGRAM_WEBHOOK_SECRET,
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query', 'chat_member', 'chat_join_request', 'pre_checkout_query'],
    });
    console.log(`[startup] Webhook установлен: ${url}`);
  } catch (err) {
    console.error('[startup] Не удалось установить вебхук:', err instanceof Error ? err.message : err);
  }
}

async function ensureBotCommands() {
  if (!BOT_TOKEN) return;
  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Приветствие и кнопка WebApp' },
      { command: 'help', description: 'Краткая справка' },
    ]);
    console.log('[startup] Команды бота установлены');
  } catch (err) {
    console.error('[startup] Не удалось установить команды бота:', err instanceof Error ? err.message : err);
  }
}

// Start server
const server = app.listen(PORT, async () => {
  console.log(`[startup] HTTP сервер запущен на порту ${PORT}`);
  if (!BOT_TOKEN) {
    console.warn('[startup] Бот без BOT_TOKEN не будет обрабатывать запросы.');
  }
  await ensureWebhook();
  await ensureBotCommands();
});

// Global error handlers
process.on('unhandledRejection', (reason) => {
  const safeMessage = reason instanceof Error ? reason.message : String(reason);
  console.error('[unhandledRejection]', safeMessage);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err instanceof Error ? err.message : String(err));
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[shutdown] Получен сигнал ${signal}. Закрываю HTTP сервер...`);
  server.close((err) => {
    if (err) {
      console.error('[shutdown] Ошибка при закрытии сервера:', err.message);
      process.exitCode = 1;
    }
    console.log('[shutdown] Сервер закрыт. Выход.');
    process.exit();
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));


