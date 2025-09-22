import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { Telegraf, Context, Markup } from 'telegraf';
import { promises as fs } from 'fs';
import path from 'path';

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN = process.env.ADMIN;
const FILE_ID = process.env.FILE_ID;
const WEB_APP_URL = process.env.WEB_APP_URL || '';
const TELEGRAM_WEBHOOK_PATH = process.env.TELEGRAM_WEBHOOK_PATH || '/telegram/webhook';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || '';
const AUTO_SET_WEBHOOK = (process.env.AUTO_SET_WEBHOOK || 'false').toLowerCase() === 'true';
const PORT = Number(process.env.PORT || 7777);
const API_BASE_URL = process.env.API_BASE_URL || '';
const BOT_BACKEND_SECRET = process.env.BOT_BACKEND_SECRET || '';
const AB_SPLIT_A = Math.max(0, Math.min(100, Number(process.env.AB_SPLIT_A ?? '50')));
const ENABLE_ANALYTICS = (process.env.ENABLE_ANALYTICS || 'true').toLowerCase() === 'true';

// User IDs file path
const USER_IDS_FILE = path.join(process.cwd(), 'user_ids.txt');

if (!BOT_TOKEN) {
  console.error('[startup] BOT_TOKEN не задан. Укажите BOT_TOKEN в .env');
}

// Log API configuration for debugging
console.log(`[startup] API_BASE_URL: ${API_BASE_URL || 'не задан'}`);
console.log(`[startup] BOT_BACKEND_SECRET: ${BOT_BACKEND_SECRET ? 'задан' : 'не задан'}`);

// Create bot instance (no bot.launch())
const bot = new Telegraf<Context>(BOT_TOKEN || '');

// Admin check function
function isAdmin(userId: number | string | undefined): boolean {
  if (!ADMIN || !userId) return false;
  return String(userId) === String(ADMIN);
}

// User ID management functions
async function readUserIds(): Promise<Set<string>> {
  try {
    const content = await fs.readFile(USER_IDS_FILE, 'utf-8');
    const ids = content.trim().split('\n').filter(id => id.trim() !== '');
    return new Set(ids);
  } catch (error) {
    // File doesn't exist or can't be read, return empty set
    return new Set();
  }
}

async function writeUserIds(userIds: Set<string>): Promise<void> {
  try {
    const content = Array.from(userIds).join('\n') + '\n';
    await fs.writeFile(USER_IDS_FILE, content, 'utf-8');
  } catch (error) {
    console.error('[user_ids] Ошибка записи файла пользователей:', error instanceof Error ? error.message : error);
  }
}

async function addUserId(userId: string): Promise<void> {
  try {
    const existingIds = await readUserIds();
    if (!existingIds.has(userId)) {
      existingIds.add(userId);
      await writeUserIds(existingIds);
      console.log(`[user_ids] Добавлен новый пользователь: ${userId}`);
    } else {
      console.log(`[user_ids] Пользователь уже существует: ${userId}`);
    }
  } catch (error) {
    console.error('[user_ids] Ошибка добавления пользователя:', error instanceof Error ? error.message : error);
  }
}

// Broadcast function
async function sendBroadcast(message: string, fileId?: string): Promise<{ success: number; failed: number; errors: string[] }> {
  const userIds = await readUserIds();
  const results = { success: 0, failed: 0, errors: [] as string[] };
  
  console.log(`[broadcast] Начинаю рассылку для ${userIds.size} пользователей`);
  
  for (const userId of userIds) {
    try {
      if (fileId) {
        // Send photo with caption
        await bot.telegram.sendPhoto(userId, fileId, {
          caption: message,
          parse_mode: 'HTML'
        });
      } else {
        // Send text only
        await bot.telegram.sendMessage(userId, message, {
          parse_mode: 'HTML'
        });
      }
      results.success++;
      console.log(`[broadcast] Успешно отправлено пользователю ${userId}`);
    } catch (error) {
      results.failed++;
      const errorMsg = `User ${userId}: ${error instanceof Error ? error.message : error}`;
      results.errors.push(errorMsg);
      console.error(`[broadcast] Ошибка отправки пользователю ${userId}:`, error);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`[broadcast] Рассылка завершена. Успешно: ${results.success}, Ошибок: ${results.failed}`);
  return results;
}

// Broadcast function with keyboard
async function sendBroadcastWithKeyboard(message: string, fileId?: string, keyboard?: any): Promise<{ success: number; failed: number; errors: string[] }> {
  const userIds = await readUserIds();
  const results = { success: 0, failed: 0, errors: [] as string[] };
  
  console.log(`[broadcast] Начинаю рассылку с кнопками для ${userIds.size} пользователей`);
  
  for (const userId of userIds) {
    try {
      if (fileId) {
        // Send photo with caption and keyboard
        await bot.telegram.sendPhoto(userId, fileId, {
          caption: message,
          parse_mode: 'HTML',
          reply_markup: keyboard?.reply_markup
        });
      } else {
        // Send text with keyboard
        await bot.telegram.sendMessage(userId, message, {
          parse_mode: 'HTML',
          reply_markup: keyboard?.reply_markup
        });
      }
      results.success++;
      console.log(`[broadcast] Успешно отправлено пользователю ${userId}`);
    } catch (error) {
      results.failed++;
      const errorMsg = `User ${userId}: ${error instanceof Error ? error.message : error}`;
      results.errors.push(errorMsg);
      console.error(`[broadcast] Ошибка отправки пользователю ${userId}:`, error);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`[broadcast] Рассылка завершена. Успешно: ${results.success}, Ошибок: ${results.failed}`);
  return results;
}

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

// Get next Thursday date and time
function getNextThursday(): string {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 4 = Thursday
  const daysUntilThursday = (4 - currentDay + 7) % 7; // Days until next Thursday (4)
  
  // If it's Thursday and before 20:00, use today, otherwise next Thursday
  const isThursday = currentDay === 4;
  const isBefore8PM = now.getHours() < 20;
  const daysToAdd = (isThursday && isBefore8PM) ? 0 : (daysUntilThursday === 0 ? 7 : daysUntilThursday);
  
  const nextThursday = new Date(now);
  nextThursday.setDate(now.getDate() + daysToAdd);
  nextThursday.setHours(20, 0, 0, 0); // Set to 20:00
  
  // Format date in Russian
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  };
  
  return nextThursday.toLocaleDateString('ru-RU', options);
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
        console.warn(`[analytics] Неуспешный статус без ретраев: ${response.status} (URL: ${url})`);
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
  if (!ENABLE_ANALYTICS) {
    return;
  }
  
  if (!API_BASE_URL || !BOT_BACKEND_SECRET) {
    // Тихо пропускаем, чтобы не засорять логи в dev
    return;
  }
  
  // Log configuration for debugging
  if (process.env.NODE_ENV === 'development') {
    console.log(`[analytics] Отправка события: ${name} (API: ${API_BASE_URL})`);
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

// Get prelaunch stats for available spots
async function getPrelaunchStats(telegramId: number | string): Promise<{ totalCount: number; timestamp: string } | null> {
  if (!API_BASE_URL || !BOT_BACKEND_SECRET) {
    console.log('[prelaunch_stats] API_BASE_URL или BOT_BACKEND_SECRET не настроены');
    return null;
  }
  
  const endpoint = `${API_BASE_URL.replace(
    /\/+$/,
    ""
  )}/rest_api/api/telegram/prelaunch/stats?telegramId=${telegramId}`;
  console.log(`[prelaunch_stats] Запрос к: ${endpoint}`);
  
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { 
        'X-API-Key': BOT_BACKEND_SECRET,
        'x-bot-secret': BOT_BACKEND_SECRET,
        'Content-Type': 'application/json'
      },
    });
    
    console.log(`[prelaunch_stats] Статус ответа: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[prelaunch_stats] Неуспешный статус: ${response.status}, ответ: ${errorText.substring(0, 200)}...`);
      return null;
    }
    
    const responseText = await response.text();
    console.log(`[prelaunch_stats] Ответ: ${responseText.substring(0, 200)}...`);
    
    // Check if response is HTML (error page)
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      console.warn('[prelaunch_stats] Получен HTML вместо JSON, возможно неправильный URL');
      return null;
    }
    
    const data = JSON.parse(responseText);
    return data;
  } catch (err) {
    console.error('[prelaunch_stats] Ошибка получения статистики:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Common start logic function
async function handleStartLogic(ctx: Context, payload?: string) {
  if (payload) {
    console.log(`[telegram] /start payload: ${payload}`);
  }

  const userId = ctx.from?.id;
  const variant = assignVariant(userId ?? '0', AB_SPLIT_A);
  const { referralCode, campaign } = parseStartPayload(payload);

  // Save user ID to file for future broadcast
  if (userId) {
    void addUserId(String(userId));
  }

  // Get dynamic stats for available spots
  const stats = await getPrelaunchStats(userId || 0);
  const availableSpots = stats?.totalCount || 47; // fallback to 47 if API fails
  const totalSpots = 200;
  
  console.log(`[start] Статистика мест для пользователя ${userId}: ${availableSpots} из ${totalSpots} (API: ${stats ? 'успешно' : 'ошибка'})`);

  const text = `🔥 <b>ДОБРО ПОЖАЛОВАТЬ В ЭЛИТНЫЙ КЛУБ!</b> 🔥

Ты попал в <b>закрытое сообщество</b> для избранных! 

💎 <b>ЧТО ТЕБЯ ЖДЕТ:</b>

🎭 <b>100% АНОНИМНОСТЬ</b> — общайся без страха, никто не узнает твою личность

⚡ <b>МГНОВЕННЫЕ ЗНАКОМСТВА</b> — находи собеседников за секунды, а не месяцы

💰 <b>ЗАРАБАТЫВАЙ РЕАЛЬНЫЕ ДЕНЬГИ</b> — получай до $50 в неделю просто за общение!

🏆 <b>VIP СТАТУС</b> — чем активнее ты, тем больше привилегий и дохода

⏰ <b>ВНИМАНИЕ!</b> Мест осталось всего <b>${availableSpots} из ${totalSpots}</b> — мы закроем прием новых участников!

<b>Не упусти свой шанс попасть в элитное сообщество!</b> 👇`;

  if (WEB_APP_URL) {
    const urlWithExp = appendQueryParam(WEB_APP_URL, 'exp', variant);
    const urlWithParams = referralCode ? appendQueryParam(urlWithExp, 'ref', referralCode) : urlWithExp;
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.webApp('🚀 Встать в очередь', urlWithParams)
      ],
      [
        Markup.button.callback('ℹ️ Узнать, как работает рейтинг', 'rating_info')
      ]
    ]).reply_markup;
    
    if (FILE_ID) {
      // Send photo with caption and keyboard
      await ctx.replyWithPhoto(FILE_ID, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    } else {
      // Send text with keyboard if no photo
      await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
    }
  } else {
    if (FILE_ID) {
      // Send photo with caption only
      await ctx.replyWithPhoto(FILE_ID, {
        caption: text,
        parse_mode: 'HTML'
      });
    } else {
      // Send text only
      await ctx.reply(text, { parse_mode: 'HTML' });
    }
  }

  // Fire-and-forget аналитика
  void postAnalyticsEvent('bot_start_shown', userId, {
    variant,
    startPayload: payload || null,
    referralCode,
    campaign,
  });
}

// Commands
bot.start(async (ctx) => {
  await handleStartLogic(ctx, ctx.startPayload);
});

bot.help(async (ctx) => {
  await ctx.reply('Доступные команды:\n/start — приветствие и кнопка WebApp\n/rating — информация о рейтинговой системе\n/help — эта справка');
});

// Rating info command
bot.command('rating', async (ctx) => {
  try {
    const ratingInfo = `📊 <b>Как работает рейтинговая система</b>

⭐ <b>Базовый рейтинг:</b> <code>100 очков</code> при регистрации

📈 <b>Повышение рейтинга:</b>
• <b>Активное общение:</b> <code>+10</code> очков за сообщение
• <b>Получение лайков:</b> <code>+5</code> очков за лайк
• <b>Помощь новичкам:</b> <code>+20</code> очков
• <b>Ежедневная активность:</b> <code>+15</code> очков

📉 <b>Понижение рейтинга:</b>
• <b>Спам:</b> <code>-50</code> очков
• <b>Нарушение правил:</b> <code>-100</code> очков
• <b>Неактивность:</b> <code>-5</code> очков в день

🏆 <b>Уровни доступа:</b>
• <code>0-200:</code> <i>Новичок</i>
• <code>201-500:</code> <i>Активный участник</i>
• <code>501-1000:</code> <i>Опытный пользователь</i>
• <code>1000+:</code> <i>VIP статус</i>

💎 <b>Особые привилегии:</b>
• Приоритет в очереди на общение
• Доступ к <i>эксклюзивным функциям</i>
• <u>Возможность зарабатывать больше</u>

<blockquote>Чем выше твой рейтинг, тем больше возможностей!</blockquote>`;

    await ctx.reply(ratingInfo, { parse_mode: 'HTML' });
    
    // Send follow-up message about giveaways after 2 seconds
    setTimeout(async () => {
      try {
        const nextThursdayDate = getNextThursday();
        const giveawayInfo = `🎉 <b>ЕЖЕНЕДЕЛЬНЫЕ РОЗЫГРЫШИ!</b>

<i>Каждый <b>четверг</b> мы разыгрываем реальные деньги среди активных участников!</i>

💰 <b>Призовой фонд:</b>
🥇 <b>1 место:</b> <code>$10</code> + VIP статус на месяц
🥈 <b>2 место:</b> <code>$5</code> + приоритет в очереди
🥉 <b>3 место:</b> <code>$3</code> + бонусные очки

🎯 <b>Дополнительные призы:</b>
• <code>$1</code> - 5 случайных участников
• <code>500 очков</code> - 10 самых активных
• <code>VIP доступ</code> - 3 новичка с лучшим рейтингом

⏰ <b>Следующий розыгрыш:</b> <u>${nextThursdayDate}</u>

<i>Чем активнее ты общаешься, тем больше шансов выиграть реальные деньги!</i>`;

        // Create keyboard with WebApp button
        const keyboard = Markup.keyboard([
          [Markup.button.text('🚀 Начать общение')]
        ]).resize().reply_markup;

        await ctx.reply(giveawayInfo, { 
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      } catch (error) {
        console.error('[rating] Ошибка при отправке информации о розыгрышах:', error);
      }
    }, 2000);
    
  } catch (err) {
    console.error('[rating] Ошибка при обработке команды rating:', err instanceof Error ? err.message : err);
    try { 
      await ctx.reply('Произошла ошибка при получении информации о рейтинге');
    } catch {}
  }
});

// Basic text handler (echo-like)
bot.on('text', async (ctx) => {
  const messageText = ctx.message?.text ?? '';
  const userId = ctx.from?.id;
  
  if (messageText.trim().length === 0) {
    return;
  }
  
  // Handle WebApp button press
  if (messageText === '🚀 Начать общение') {
    await handleStartLogic(ctx);
    return;
  }
  
  // Check for admin broadcast command
  if (messageText === 'тестовая рассылка' && isAdmin(userId)) {
    // Get dynamic stats for available spots
    const stats = await getPrelaunchStats(userId || 0);
    const availableSpots = stats?.totalCount || 47; // fallback to 47 if API fails
    const totalSpots = 200;
    
    console.log(`[broadcast] Статистика мест: ${availableSpots} из ${totalSpots} (API: ${stats ? 'успешно' : 'ошибка'})`);
    
    const broadcastMessage = `🔥 <b>ЭКСКЛЮЗИВНОЕ ПРЕДЛОЖЕНИЕ!</b> 🔥

Ты попал в <b>закрытый клуб</b> для избранных! 

💎 <b>ЧТО ТЕБЯ ЖДЕТ:</b>

🎭 <b>100% АНОНИМНОСТЬ</b> — общайся без страха, никто не узнает твою личность

⚡ <b>МГНОВЕННЫЕ ЗНАКОМСТВА</b> — находи собеседников за секунды, а не месяцы

💰 <b>ЗАРАБАТЫВАЙ РЕАЛЬНЫЕ ДЕНЬГИ</b> — получай до $50 в неделю просто за общение!

🏆 <b>VIP СТАТУС</b> — чем активнее ты, тем больше привилегий и дохода

⏰ <b>ВНИМАНИЕ!</b> Мест осталось всего <b>${availableSpots} из ${totalSpots}</b> — мы закроем прием новых участников!

<b>Не упусти свой шанс попасть в элитное сообщество!</b> 👇`;
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.webApp(
          "🔍 Найти собеседника",
          WEB_APP_URL || "https://example.com"
        ),
      ],
      [
        Markup.button.webApp(
          "🚀 Встать в очередь",
          WEB_APP_URL || "https://example.com"
        ),
      ],
      [
        Markup.button.callback(
          "ℹ️ Узнать, как работает рейтинг",
          "rating_info"
        ),
      ],
    ]);
    
    try {
      await ctx.reply('🚀 Начинаю тестовую рассылку...');
      const results = await sendBroadcastWithKeyboard(broadcastMessage, FILE_ID, keyboard);
      
      let response = `📊 <b>Результаты рассылки:</b>\n\n`;
      response += `✅ Успешно отправлено: ${results.success}\n`;
      response += `❌ Ошибок: ${results.failed}\n`;
      
      if (results.errors.length > 0) {
        response += `\n<b>Ошибки:</b>\n`;
        results.errors.slice(0, 5).forEach(error => {
          response += `• ${error}\n`;
        });
        if (results.errors.length > 5) {
          response += `• ... и еще ${results.errors.length - 5} ошибок\n`;
        }
      }
      
      await ctx.reply(response, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('[broadcast] Ошибка при выполнении рассылки:', error);
      await ctx.reply('❌ Произошла ошибка при выполнении рассылки');
    }
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

// Handle rating info callback
bot.action('rating_info', async (ctx) => {
  try {
    const ratingInfo = `📊 <b>Как работает рейтинговая система</b>

⭐ <b>Базовый рейтинг:</b> <code>100 очков</code> при регистрации

📈 <b>Повышение рейтинга:</b>
• <b>Активное общение:</b> <code>+10</code> очков за сообщение
• <b>Получение лайков:</b> <code>+5</code> очков за лайк
• <b>Помощь новичкам:</b> <code>+20</code> очков
• <b>Ежедневная активность:</b> <code>+15</code> очков

📉 <b>Понижение рейтинга:</b>
• <b>Спам:</b> <code>-50</code> очков
• <b>Нарушение правил:</b> <code>-100</code> очков
• <b>Неактивность:</b> <code>-5</code> очков в день

🏆 <b>Уровни доступа:</b>
• <code>0-200:</code> <i>Новичок</i>
• <code>201-500:</code> <i>Активный участник</i>
• <code>501-1000:</code> <i>Опытный пользователь</i>
• <code>1000+:</code> <i>VIP статус</i>

💎 <b>Особые привилегии:</b>
• Приоритет в очереди на общение
• Доступ к <i>эксклюзивным функциям</i>
• <u>Возможность зарабатывать больше</u>

<blockquote>Чем выше твой рейтинг, тем больше возможностей!</blockquote>`;

    await ctx.answerCbQuery();
    await ctx.reply(ratingInfo, { parse_mode: 'HTML' });
    
    // Send follow-up message about giveaways after 2 seconds
    setTimeout(async () => {
      try {
        const nextThursdayDate = getNextThursday();
        const giveawayInfo = `🎉 <b>ЕЖЕНЕДЕЛЬНЫЕ РОЗЫГРЫШИ!</b>

<i>Каждый <b>четверг</b> мы разыгрываем реальные деньги среди активных участников!</i>

💰 <b>Призовой фонд:</b>
🥇 <b>1 место:</b> <code>$10</code> + VIP статус на месяц
🥈 <b>2 место:</b> <code>$5</code> + приоритет в очереди
🥉 <b>3 место:</b> <code>$3</code> + бонусные очки

🎯 <b>Дополнительные призы:</b>
• <code>$1</code> - 5 случайных участников
• <code>500 очков</code> - 10 самых активных
• <code>VIP доступ</code> - 3 новичка с лучшим рейтингом

⏰ <b>Следующий розыгрыш:</b> <u>${nextThursdayDate}</u>

<i>Чем активнее ты общаешься, тем больше шансов выиграть реальные деньги!</i>`;

        // Create keyboard with WebApp button
        const keyboard = Markup.keyboard([
          [Markup.button.text('🚀 Начать общение')]
        ]).resize().reply_markup;

        await ctx.reply(giveawayInfo, { 
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      } catch (error) {
        console.error('[rating_info] Ошибка при отправке информации о розыгрышах:', error);
      }
    }, 2000);
    
  } catch (err) {
    console.error('[rating_info] Ошибка при обработке rating_info:', err instanceof Error ? err.message : err);
    try { 
      await ctx.answerCbQuery('Произошла ошибка');
    } catch {}
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

// Get user IDs for broadcast
app.get('/users', requireBackendSecret, async (_req: Request, res: Response) => {
  try {
    const userIds = await readUserIds();
    const userIdsArray = Array.from(userIds);
    res.status(200).json({ 
      count: userIdsArray.length,
      userIds: userIdsArray 
    });
  } catch (error) {
    console.error('[users] Ошибка получения списка пользователей:', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Internal error' });
  }
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
      { command: 'rating', description: 'Информация о рейтинговой системе' },
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


