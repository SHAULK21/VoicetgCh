import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize Gemini Client
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Global In-Memory Bot State
interface ChannelMessage {
  id: string;
  channelTitle: string;
  channelUsername: string;
  text: string;
  date: number;
  hasAlert: boolean;
  matchedWords: string[];
  spokenText: string;
  audioBase64?: string;
  timestamp: string;
  isNightMode?: boolean;
}

interface VoiceSettings {
  voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  speechRate: number;
  pitch: number;
  alertVolumeBoost: number;
  engine: 'gemini' | 'browser';
  autoSpeak: boolean;
  nightMode: boolean;
  nightVolume: number;
  nightVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
}

interface TrackedChannel {
  username: string; // clean username without @
  title: string;
  lastPostId?: string;
  lastChecked?: number;
  error?: string;
  isActive: boolean;
  subscriberCount?: string;
}

let filterWords: string[] = ['внимание', 'срочно', 'тревога', 'важно', 'ликвидация', 'памп'];

let voiceSettings: VoiceSettings = {
  voiceName: 'Kore',
  speechRate: 1.0,
  pitch: 0,
  alertVolumeBoost: 2.2,
  engine: 'gemini',
  autoSpeak: true,
  nightMode: false,
  nightVolume: 0.28,
  nightVoice: 'Zephyr',
};

let botConfig = {
  token: '',
  botUsername: '',
  botName: '',
  isPolling: false,
  targetChannel: '@crypto_news_alerts',
  lastError: '',
  status: 'standby' as 'standby' | 'polling' | 'connected' | 'error',
};

// Monitored Public Channels (no admin rights needed!)
let trackedChannels: TrackedChannel[] = [
  {
    username: 'bbbreaking',
    title: 'Раньше всех. Ну почти',
    isActive: true,
    subscriberCount: '2.4M',
  },
  {
    username: 'bankrollo',
    title: 'Банкста',
    isActive: true,
    subscriberCount: '480K',
  },
];

const messageHistory: ChannelMessage[] = [];
const sseClients: Response[] = [];

// Helper to broadcast via SSE
function broadcast(eventType: string, data: any) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(payload);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

// Function to format text with filter words & 3x loud shouting
export function formatSpokenText(
  originalText: string,
  words: string[],
  isNight: boolean
): { spokenText: string; hasAlert: boolean; matchedWords: string[] } {
  const lowerText = originalText.toLowerCase();
  const matched: string[] = [];

  for (const filter of words) {
    const cleanFilter = filter.trim().toLowerCase();
    if (!cleanFilter) continue;
    if (lowerText.includes(cleanFilter)) {
      if (!matched.includes(filter.trim())) {
        matched.push(filter.trim());
      }
    }
  }

  const hasAlert = matched.length > 0;
  if (!hasAlert) {
    return { spokenText: originalText, hasAlert: false, matchedWords: [] };
  }

  // Requirement: "И если вдруг увидит слова, которые будут добавлены в список фильтра,
  // то должен очень громко их прочитать 3 раза с знаками восклицания"
  // Even in Night mode: breaks out of night mode and shouts with maximum energy!
  const alertPrefix = matched
    .map((w) => {
      const shout = w.toUpperCase();
      return `${shout}! ${shout}! ${shout}!`;
    })
    .join(' ');

  const spokenText = `ВНИМАНИЕ! ТРЕВОЖНЫЙ СИГНАЛ! ${alertPrefix} \n\n ${originalText}`;
  return { spokenText, hasAlert: true, matchedWords: matched };
}

// Synthesize audio using Gemini 3.8 Flash Lite TTS
async function synthesizeGeminiAudio(
  text: string,
  voiceName: string,
  isAlert: boolean,
  isNight: boolean
): Promise<string | null> {
  if (!ai && process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  if (!ai) {
    return null;
  }

  try {
    let styleDescription: string;
    let selectedVoice = voiceName;

    if (isAlert) {
      // Urgent loud exclamation shouting style with human adrenaline
      styleDescription = 'Extremely loud, urgent Russian emergency broadcast alert. Shouting emphatically, energetically and dramatically with realistic human adrenaline, vivid exclamation marks, and loud volume!';
    } else if (isNight) {
      // Night Mode: intimate, tender, soft, realistic human whisper
      styleDescription = 'Ultra-gentle, delicate, soothing, soft human whisper in natural fluent Russian. A warm, tender bedtime voice speaking very quietly, intimately and calmly with realistic breathing and zero robotic stiffness.';
      selectedVoice = voiceSettings.nightVoice || 'Zephyr';
    } else {
      // Standard: natural fluent Russian studio presenter
      styleDescription = 'Lifelike, authentic, warm human voice of a professional Russian radio broadcaster. Speak fluently with organic human inflection, lifelike subtle pauses, expressive melody, and pleasant warm studio diction. Completely natural, human and realistic.';
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: text.slice(0, 800),
              speechMetadata: {
                style: styleDescription,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: (['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].includes(selectedVoice)
                ? selectedVoice
                : 'Kore') as any,
            },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (err: any) {
    console.error('Gemini TTS error:', err?.message || err);
    return null;
  }
}

// Process incoming channel post (from Telegram Bot, Public Channel Scraper, or Simulator)
async function handleIncomingChannelPost(payload: {
  channelTitle?: string;
  channelUsername?: string;
  text: string;
  date?: number;
}): Promise<ChannelMessage> {
  const { channelTitle = 'Telegram Channel', channelUsername = '@target_channel', text, date = Date.now() } = payload;

  const isNight = voiceSettings.nightMode;
  const { spokenText, hasAlert, matchedWords } = formatSpokenText(text, filterWords, isNight);

  let audioBase64: string | null = null;
  if (voiceSettings.engine === 'gemini') {
    audioBase64 = await synthesizeGeminiAudio(spokenText, voiceSettings.voiceName, hasAlert, isNight);
  }

  const messageItem: ChannelMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    channelTitle,
    channelUsername,
    text,
    date,
    hasAlert,
    matchedWords,
    spokenText,
    audioBase64: audioBase64 || undefined,
    timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    isNightMode: isNight && !hasAlert,
  };

  messageHistory.unshift(messageItem);
  if (messageHistory.length > 50) messageHistory.pop();

  broadcast('new_post', messageItem);
  return messageItem;
}

// -------------------------------------------------------------
// PUBLIC TELEGRAM CHANNEL SCRAPER (No Admin Rights Needed!)
// -------------------------------------------------------------
function cleanHtml(html: string): string {
  return html
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<a[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '$1')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '$1')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .trim();
}

async function fetchPublicChannel(channel: TrackedChannel, isInitialInit = false): Promise<number> {
  const cleanUser = channel.username.replace(/^@/, '').trim();
  const url = `https://t.me/s/${cleanUser}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8',
      },
    });

    if (!res.ok) {
      channel.error = `HTTP ${res.status}`;
      return 0;
    }

    const html = await res.text();
    channel.lastChecked = Date.now();
    channel.error = undefined;

    // Extract channel title if available
    const titleMatch = html.match(/class="tgme_channel_info_header_title"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);
    if (titleMatch && titleMatch[1]) {
      channel.title = cleanHtml(titleMatch[1]);
    }

    // Extract subscriber count
    const subsMatch = html.match(/class="tgme_channel_info_counter"><span class="counter_value">([^<]+)<\/span>/i);
    if (subsMatch && subsMatch[1]) {
      channel.subscriberCount = subsMatch[1].trim();
    }

    // Extract all messages
    // Pattern: data-post="channel/1234"
    const messageBlockRegex = /class="tgme_widget_message\s+[^"]*"\s+data-post="([^"]+)"[\s\S]*?<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const posts: Array<{ postId: string; text: string; numId: number }> = [];

    let match;
    while ((match = messageBlockRegex.exec(html)) !== null) {
      const postId = match[1];
      const rawText = match[2];
      const text = cleanHtml(rawText);
      const numId = parseInt(postId.split('/')[1] || '0', 10);
      if (text) {
        posts.push({ postId, text, numId });
      }
    }

    if (posts.length === 0) return 0;

    // Sort by numId ascending
    posts.sort((a, b) => a.numId - b.numId);
    const latestPost = posts[posts.length - 1];

    if (isInitialInit || !channel.lastPostId) {
      // First check: store latest post ID without replaying historical backlog
      channel.lastPostId = latestPost.postId;
      broadcast('channels_updated', trackedChannels);
      return 0;
    }

    const prevNumId = parseInt(channel.lastPostId.split('/')[1] || '0', 10);
    const newPosts = posts.filter((p) => p.numId > prevNumId);

    if (newPosts.length > 0) {
      channel.lastPostId = latestPost.postId;
      broadcast('channels_updated', trackedChannels);

      // Emit new incoming posts immediately
      for (const p of newPosts) {
        await handleIncomingChannelPost({
          channelTitle: channel.title || `@${channel.username}`,
          channelUsername: `@${channel.username}`,
          text: p.text,
        });
      }
      return newPosts.length;
    }

    return 0;
  } catch (err: any) {
    channel.error = err?.message || 'Ошибка загрузки страницы канала';
    return 0;
  }
}

// Background Public Channel Monitor loop (every 10 seconds)
setInterval(async () => {
  for (const channel of trackedChannels) {
    if (!channel.isActive) continue;
    await fetchPublicChannel(channel, false);
    // Stagger calls slightly to be gentle
    await new Promise((r) => setTimeout(r, 1500));
  }
}, 10000);

// Initialize tracked channels on server launch
setTimeout(async () => {
  for (const channel of trackedChannels) {
    await fetchPublicChannel(channel, true);
  }
}, 2000);

// Telegram Bot Command Interpreter
async function executeBotCommand(commandText: string, chatId?: number | string): Promise<string> {
  const trimmed = commandText.trim();
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ').trim();

  let reply = '';

  switch (command) {
    case '/start':
      reply = `👋 Привет! Я голосовой бот моментального чтения публичных и закрытых Telegram каналов.

🔔 ФИЛЬТР И ОЗВУЧКА:
• Моментально читает новые посты вслух.
• Если в тексте есть ключевые слова фильтра — громко кричит их 3 раза со знаками восклицания!
• В ночном режиме читает тихим ласковым шёпотом, пока не появится важное слово из фильтра!

⚙️ КОМАНДЫ ФИЛЬТРА СЛОВ:
/add <слово> — Добавить слово в фильтр
/remove <слово> — Удалить слово из фильтра
/list — Показать слова фильтра
/clear — Очистить фильтр

🌙 НОЧНОЙ РЕЖИМ (Тихий нежный голос):
/night — Переключить ночной режим
/night on — Включить нежный тихий голос
/night off — Выключить ночной режим

📢 ПУБЛИЧНЫЕ КАНАЛЫ (Без прав админа!):
/channel add @username — Добавить любой публичный канал
/channel remove @username — Удалить канал
/channels — Список отслеживаемых каналов

🎙️ НАСТРОЙКИ:
/voice <Puck|Kore|Fenrir|Charon|Zephyr> — Сменить голос
/test <текст> — Проверить звук прямо сейчас
/status — Текущее состояние бота`;
      break;

    case '/night': {
      if (args.toLowerCase() === 'on') {
        voiceSettings.nightMode = true;
      } else if (args.toLowerCase() === 'off') {
        voiceSettings.nightMode = false;
      } else {
        voiceSettings.nightMode = !voiceSettings.nightMode;
      }
      broadcast('settings_updated', { voiceSettings });
      reply = voiceSettings.nightMode
        ? '🌙 *Ночной режим включен!* Сообщения теперь читаются тихим, нежным и мягким шёпотом. Но если сработает слово из фильтра — бот мгновенно прокричит его 3 раза на максимальной громкости!'
        : '☀️ *Ночной режим выключен.* Возобновлена стандартная дикторская громкость.';
      break;
    }

    case '/channel':
    case '/ch': {
      const subParts = args.split(/\s+/);
      const subCmd = subParts[0]?.toLowerCase();
      const chName = subParts[1]?.replace(/^@/, '').trim();

      if (subCmd === 'add' && chName) {
        const clean = chName.replace(/https?:\/\/t\.me\//, '').replace(/^s\//, '');
        if (!trackedChannels.some((c) => c.username.toLowerCase() === clean.toLowerCase())) {
          const newCh: TrackedChannel = {
            username: clean,
            title: `@${clean}`,
            isActive: true,
          };
          trackedChannels.push(newCh);
          fetchPublicChannel(newCh, true);
          broadcast('channels_updated', trackedChannels);
          reply = `✅ Общедоступный канал *@${clean}* добавлен в мониторинг (права админа не требуются!). Бот будет озвучивать все новые публикации.`;
        } else {
          reply = `ℹ️ Канал @${clean} уже отслеживается.`;
        }
      } else if ((subCmd === 'remove' || subCmd === 'del') && chName) {
        const clean = chName.replace(/https?:\/\/t\.me\//, '').replace(/^s\//, '');
        const prevCount = trackedChannels.length;
        trackedChannels = trackedChannels.filter((c) => c.username.toLowerCase() !== clean.toLowerCase());
        broadcast('channels_updated', trackedChannels);
        reply = trackedChannels.length < prevCount
          ? `🗑️ Канал @${clean} удален из мониторинга.`
          : `⚠️ Канал @${clean} не найден в списке.`;
      } else {
        const list = trackedChannels.map((c, i) => `${i + 1}. *${c.title}* (@${c.username})`).join('\n');
        reply = `📢 *Отслеживаемые общедоступные каналы* (без прав админа):\n\n${list || 'Список пуст.'}\n\nДля добавления используйте: \`/channel add @username\``;
      }
      break;
    }

    case '/channels': {
      const list = trackedChannels.map((c, i) => `${i + 1}. *${c.title}* (@${c.username}) ${c.subscriberCount ? `(${c.subscriberCount} подп.)` : ''}`).join('\n');
      reply = `📢 *Отслеживаемые каналы*:\n\n${list || 'Список пуст.'}\n\nДобавить: \`/channel add @username\``;
      break;
    }

    case '/add':
      if (!args) {
        reply = '⚠️ Укажите слово или фразу для добавления. Пример: `/add ликвидация`';
      } else {
        const wordsToAdd = args.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
        const added: string[] = [];
        for (const w of wordsToAdd) {
          if (!filterWords.includes(w)) {
            filterWords.push(w);
            added.push(w);
          }
        }
        if (added.length > 0) {
          reply = `✅ Добавлено в список фильтра: *${added.join(', ')}*\nВсего слов в фильтре: ${filterWords.length}`;
          broadcast('filter_updated', { filterWords });
        } else {
          reply = `ℹ️ Эти слова уже присутствуют в фильтре. Список: ${filterWords.join(', ')}`;
        }
      }
      break;

    case '/remove':
    case '/del':
      if (!args) {
        reply = '⚠️ Укажите слово для удаления. Пример: `/remove срочно`';
      } else {
        const wordToRemove = args.toLowerCase();
        const initialLen = filterWords.length;
        filterWords = filterWords.filter((w) => w.toLowerCase() !== wordToRemove);
        if (filterWords.length < initialLen) {
          reply = `🗑️ Слово *"${args}"* успешно удалено из фильтра.\nОсталось слов: ${filterWords.length}`;
          broadcast('filter_updated', { filterWords });
        } else {
          reply = `⚠️ Слово "${args}" не найдено в списке фильтра. Список: ${filterWords.join(', ')}`;
        }
      }
      break;

    case '/list':
      if (filterWords.length === 0) {
        reply = '📭 Список фильтра пуст. Добавьте слова командой: `/add <слово>`';
      } else {
        const formattedList = filterWords.map((w, idx) => `${idx + 1}. *${w}* 🚨 (будет прокричано 3 раза!)`).join('\n');
        reply = `📋 Активные слова-триггеры для громкой озвучки:\n\n${formattedList}\n\nВсего: ${filterWords.length} слов.`;
      }
      break;

    case '/clear':
      filterWords = [];
      reply = '🧹 Список фильтра полностью очищен.';
      broadcast('filter_updated', { filterWords });
      break;

    case '/voice': {
      const validVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
      const targetVoice = validVoices.find((v) => v.toLowerCase() === args.toLowerCase());
      if (targetVoice) {
        voiceSettings.voiceName = targetVoice as any;
        reply = `🎙️ Голос переключен на: *${targetVoice}*`;
        broadcast('settings_updated', { voiceSettings });
      } else {
        reply = `⚠️ Неверное имя голоса. Доступные: ${validVoices.join(', ')}. Пример: \`/voice Kore\``;
      }
      break;
    }

    case '/status':
      reply = `📊 *Статус системы*:
• Ночной режим: ${voiceSettings.nightMode ? '🌙 ВКЛЮЧЕН (тихий нежный голос)' : '☀️ ВЫКЛЮЧЕН (стандартный)'}
• Бот: ${botConfig.botUsername ? `@${botConfig.botUsername}` : 'Веб-станция'}
• Отслеживается каналов: ${trackedChannels.length}
• Слов в фильтре: ${filterWords.length}
• Голос: ${voiceSettings.voiceName} (Ночной голос: ${voiceSettings.nightVoice})`;
      break;

    case '/test': {
      const sample = args || 'Внимание! Это тестовое сообщение для проверки мгновенной озвучки.';
      await handleIncomingChannelPost({
        channelTitle: 'Тестовый Канал',
        channelUsername: '@test_channel',
        text: sample,
      });
      reply = `🔊 Тестовое сообщение отправлено в эфир и озвучивается:\n"${sample}"`;
      break;
    }

    case '/help':
      reply = `📖 *Справка по командам*:
• \`/night [on|off]\` — включить/выключить тихий нежный ночной режим
• \`/channel add @username\` — добавить общедоступный канал без прав админа
• \`/channel remove @username\` — удалить канал
• \`/channels\` — список отслеживаемых каналов
• \`/add <слово>\` — добавить слово в фильтр для громкого крика
• \`/remove <слово>\` — удалить слово
• \`/list\` — список слов фильтра
• \`/voice <name>\` — выбрать голос (Puck, Kore, Fenrir, Charon, Zephyr)
• \`/test <текст>\` — проверить громкую озвучку
• \`/status\` — параметры системы`;
      break;

    default:
      reply = `Неизвестная команда "${command}". Напишите /help для справки.`;
      break;
  }

  // If chatId provided and real bot token exists, reply to Telegram
  if (chatId && botConfig.token) {
    try {
      await fetch(`https://api.telegram.org/bot${botConfig.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: reply,
          parse_mode: 'Markdown',
        }),
      });
    } catch (e) {
      console.error('Error sending Telegram response:', e);
    }
  }

  return reply;
}

// Telegram Polling Runner
let pollingAbortController: AbortController | null = null;

async function startTelegramPolling(token: string) {
  if (botConfig.isPolling) {
    stopTelegramPolling();
  }

  botConfig.token = token;
  botConfig.isPolling = true;
  botConfig.status = 'polling';
  pollingAbortController = new AbortController();

  try {
    const getMeRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meData = await getMeRes.json();
    if (!meData.ok) {
      botConfig.status = 'error';
      botConfig.lastError = meData.description || 'Неверный токен бота';
      botConfig.isPolling = false;
      broadcast('bot_status', botConfig);
      return false;
    }

    botConfig.botUsername = meData.result.username;
    botConfig.botName = meData.result.first_name;
    botConfig.status = 'connected';
    botConfig.lastError = '';
    broadcast('bot_status', botConfig);

    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);

    (async () => {
      let offset = 0;
      while (botConfig.isPolling && !pollingAbortController?.signal.aborted) {
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=15`, {
            signal: pollingAbortController?.signal,
          });
          const updateData = await res.json();
          if (updateData.ok && Array.isArray(updateData.result)) {
            for (const update of updateData.result) {
              offset = update.update_id + 1;

              // Channel post detection (if bot is admin in channel)
              if (update.channel_post && update.channel_post.text) {
                const channel = update.channel_post.chat;
                const channelTitle = channel.title || 'Telegram Channel';
                const channelUsername = channel.username ? `@${channel.username}` : `Channel #${channel.id}`;
                const text = update.channel_post.text;

                await handleIncomingChannelPost({
                  channelTitle,
                  channelUsername,
                  text,
                  date: update.channel_post.date * 1000,
                });
              }

              // Direct bot commands
              if (update.message && update.message.text) {
                const text = update.message.text.trim();
                const chatId = update.message.chat.id;

                if (text.startsWith('/')) {
                  const replyText = await executeBotCommand(text, chatId);
                  broadcast('bot_command_log', {
                    user: update.message.from?.username || update.message.from?.first_name || 'User',
                    command: text,
                    reply: replyText,
                    timestamp: new Date().toLocaleTimeString('ru-RU'),
                  });
                }
              }
            }
          }
        } catch (err: any) {
          if (err.name === 'AbortError') break;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();

    return true;
  } catch (err: any) {
    botConfig.status = 'error';
    botConfig.lastError = err?.message || 'Ошибка подключения к Telegram API';
    botConfig.isPolling = false;
    broadcast('bot_status', botConfig);
    return false;
  }
}

function stopTelegramPolling() {
  botConfig.isPolling = false;
  if (pollingAbortController) {
    pollingAbortController.abort();
    pollingAbortController = null;
  }
  botConfig.status = 'standby';
  broadcast('bot_status', botConfig);
}

// -------------------------------------------------------------
// REST API ROUTES
// -------------------------------------------------------------

// SSE stream for real-time live events to UI
app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);

  const initialPayload = {
    botConfig,
    filterWords,
    voiceSettings,
    trackedChannels,
    history: messageHistory.slice(0, 20),
  };
  res.write(`event: init\ndata: ${JSON.stringify(initialPayload)}\n\n`);

  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// TTS Endpoint
app.post('/api/tts', async (req: Request, res: Response) => {
  const { text, voiceName = 'Kore', isAlert = false, isNight = false } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text parameter is required' });
  }

  const audioBase64 = await synthesizeGeminiAudio(text, voiceName, isAlert, isNight || voiceSettings.nightMode);
  if (!audioBase64) {
    return res.status(503).json({
      error: 'TTS generation unavailable',
      fallbackToBrowser: true,
    });
  }

  res.json({
    audioBase64,
    mimeType: 'audio/wav',
    voiceName,
    isAlert,
    isNight,
  });
});

// Public Channels Management Endpoints (NO ADMIN RIGHTS NEEDED)
app.get('/api/channels', (_req: Request, res: Response) => {
  res.json({ trackedChannels });
});

app.post('/api/channels', async (req: Request, res: Response) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const clean = username.replace(/https?:\/\/t\.me\//, '').replace(/^s\//, '').replace(/^@/, '').trim();
  if (!clean) {
    return res.status(400).json({ error: 'Invalid channel username' });
  }

  let existing = trackedChannels.find((c) => c.username.toLowerCase() === clean.toLowerCase());
  if (!existing) {
    existing = {
      username: clean,
      title: `@${clean}`,
      isActive: true,
    };
    trackedChannels.push(existing);
  } else {
    existing.isActive = true;
  }

  // Fetch immediately to load title, stats, and last post
  await fetchPublicChannel(existing, true);
  broadcast('channels_updated', trackedChannels);

  res.json({ success: true, channel: existing, trackedChannels });
});

app.delete('/api/channels/:username', (req: Request, res: Response) => {
  const clean = req.params.username.replace(/^@/, '').trim().toLowerCase();
  trackedChannels = trackedChannels.filter((c) => c.username.toLowerCase() !== clean);
  broadcast('channels_updated', trackedChannels);
  res.json({ success: true, trackedChannels });
});

app.post('/api/channels/toggle', (req: Request, res: Response) => {
  const { username } = req.body;
  const clean = (username || '').replace(/^@/, '').trim().toLowerCase();
  const found = trackedChannels.find((c) => c.username.toLowerCase() === clean);
  if (found) {
    found.isActive = !found.isActive;
    broadcast('channels_updated', trackedChannels);
  }
  res.json({ success: true, trackedChannels });
});

app.post('/api/channels/check-now', async (_req: Request, res: Response) => {
  let newPostsCount = 0;
  for (const channel of trackedChannels) {
    if (channel.isActive) {
      newPostsCount += await fetchPublicChannel(channel, false);
    }
  }
  res.json({ success: true, newPostsCount, trackedChannels });
});

// Bot Configuration
app.post('/api/bot/config', async (req: Request, res: Response) => {
  const { token, action } = req.body;

  if (action === 'stop') {
    stopTelegramPolling();
    return res.json({ success: true, botConfig });
  }

  if (action === 'start' || (!action && token)) {
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    const success = await startTelegramPolling(token);
    return res.json({ success, botConfig });
  }

  res.json({ botConfig });
});

// Update Filter Words
app.post('/api/bot/filter-words', (req: Request, res: Response) => {
  const { words, action, word } = req.body;

  if (action === 'add' && word) {
    const clean = word.trim().toLowerCase();
    if (clean && !filterWords.includes(clean)) {
      filterWords.push(clean);
    }
  } else if (action === 'remove' && word) {
    filterWords = filterWords.filter((w) => w.toLowerCase() !== word.trim().toLowerCase());
  } else if (action === 'set' && Array.isArray(words)) {
    filterWords = words.map((w: string) => w.trim().toLowerCase()).filter(Boolean);
  } else if (action === 'clear') {
    filterWords = [];
  }

  broadcast('filter_updated', { filterWords });
  res.json({ success: true, filterWords });
});

// Update Voice & Synthesis Settings (Includes Night Mode)
app.post('/api/bot/voice-settings', (req: Request, res: Response) => {
  const settings = req.body;
  voiceSettings = { ...voiceSettings, ...settings };
  broadcast('settings_updated', { voiceSettings });
  res.json({ success: true, voiceSettings });
});

// Simulate Channel Post
app.post('/api/bot/simulate-post', async (req: Request, res: Response) => {
  const { text, channelTitle = 'Крипто Пульс | Live', channelUsername = '@cryptopulse_live' } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const processed = await handleIncomingChannelPost({
    channelTitle,
    channelUsername,
    text,
  });

  res.json({ success: true, message: processed });
});

// Simulate Bot Command
app.post('/api/bot/execute-command', async (req: Request, res: Response) => {
  const { command } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }

  const reply = await executeBotCommand(command);
  res.json({ command, reply, filterWords, voiceSettings, trackedChannels });
});

// Webhook receiver for Telegram
app.post('/api/bot/webhook', async (req: Request, res: Response) => {
  const update = req.body;

  if (update?.channel_post?.text) {
    const post = update.channel_post;
    await handleIncomingChannelPost({
      channelTitle: post.chat?.title || 'Telegram Channel',
      channelUsername: post.chat?.username ? `@${post.chat.username}` : `Channel #${post.chat.id}`,
      text: post.text,
      date: (post.date || Date.now() / 1000) * 1000,
    });
  } else if (update?.message?.text?.startsWith('/')) {
    await executeBotCommand(update.message.text, update.message.chat.id);
  }

  res.sendStatus(200);
});

// Start Server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
