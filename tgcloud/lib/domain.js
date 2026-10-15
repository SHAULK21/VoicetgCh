export const DEFAULT_WORDS = ['внимание', 'срочно', 'тревога', 'важно'];
export const VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
export const DEFAULT_SETTINGS = {
  voiceName: 'Kore', speechRate: 1, pitch: 0, alertVolumeBoost: 2.2,
  engine: 'browser', autoSpeak: true, nightMode: false, nightVolume: 0.28,
  nightVoice: 'Zephyr', notify: true,
};
export class AppError extends Error {
  constructor(message, code = 'INVALID_INPUT') { super(message); this.code = code; }
}
export function requireUser(user) {
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new AppError('Откройте панель из Telegram.', 'UNAUTHORIZED');
  return user.id;
}
export function textInput(value, max = 8000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(`Нужен текст длиной до ${max} символов.`);
  return value.trim();
}
export function normalizeChannel(value) {
  const input = textInput(value, 200).trim();
  const username = input.replace(/^https?:\/\/t\.me\/(?:s\/)?/i, '').replace(/^t\.me\/(?:s\/)?/i, '').replace(/^@/, '').replace(/\/$/, '');
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(username)) throw new AppError('Укажите @username или ссылку t.me/username без номера поста.');
  return username.toLowerCase();
}
export function normalizeWords(words) {
  if (!Array.isArray(words) || words.length > 40) throw new AppError('Допустимо до 40 слов или фраз.');
  return [...new Set(words.map(w => textInput(w, 48).toLowerCase()))];
}
export function validateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new AppError('Неверные настройки.');
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) throw new AppError(`Неизвестная настройка: ${key}`);
    if (['voiceName', 'nightVoice'].includes(key)) {
      if (!VOICES.includes(value)) throw new AppError('Неизвестный голос.');
    } else if (key === 'engine') {
      if (!['gemini', 'browser'].includes(value)) throw new AppError('Неизвестный движок.');
    } else if (['autoSpeak', 'nightMode', 'notify'].includes(key)) {
      if (typeof value !== 'boolean') throw new AppError('Неверный переключатель.');
    } else {
      const [min, max] = {speechRate:[0.75,1.75],pitch:[-5,5],alertVolumeBoost:[1.5,3.5],nightVolume:[0.15,0.45]}[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new AppError('Настройка вне допустимого диапазона.');
    }
    result[key] = value;
  }
  return result;
}
export function formatSpokenText(text, words, isNight = false) {
  const lower = text.toLowerCase();
  const matchedWords = [...new Set(words.map(w => w.trim().toLowerCase()).filter(w => w && lower.includes(w)))];
  const prefix = matchedWords.map(w => `${w.toUpperCase()}! ${w.toUpperCase()}! ${w.toUpperCase()}!`).join(' ');
  return { hasAlert: !!prefix, matchedWords, spokenText: prefix ? `ВНИМАНИЕ! ${prefix}\n\n${text}` : text, isNightMode: isNight && !prefix };
}
export function splitText(text, max = 1200) {
  const result = [];
  let rest = text;
  while (rest.length > max) {
    let end = rest.lastIndexOf(' ', max);
    if (end < max / 2) end = max;
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    result.push(rest.slice(0, end)); rest = rest.slice(end);
  }
  if (rest) result.push(rest);
  return result;
}
export function commandParts(text) {
  const [token, ...args] = textInput(text, 4096).split(/\s+/);
  const [name, recipient] = token.toLowerCase().split('@');
  return {name, recipient, args: args.join(' ').trim()};
}
export function decodeHtml(value) {
  return value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos|nbsp);/gi, (_, code) => {
    const named = {quot:'"',amp:'&',lt:'<',gt:'>',apos:"'",nbsp:' '};
    if (named[code.toLowerCase()]) return named[code.toLowerCase()];
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2),16) : parseInt(code.slice(1),10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).trim();
}
// Bound each message before searching for its text: media-only messages cannot
// borrow the next message's body. Telegram's HTML is an optional public source.
export function parsePublicChannel(html, username) {
  const starts = [...html.matchAll(/<div\b[^>]*class="tgme_widget_message\s+[^"]*"[^>]*data-post="([a-zA-Z0-9_]+)\/(\d+)"/gi)];
  const posts = [];
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i];
    if (m[1].toLowerCase() !== username.toLowerCase()) continue;
    const block = html.slice(m.index, starts[i+1]?.index ?? html.length);
    const body = block.match(/<div\b[^>]*class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
    const text = body ? decodeHtml(body[1]) : '';
    const date = block.match(/<time\b[^>]*datetime="([^"]+)"/i)?.[1];
    posts.push({messageId: Number(m[2]), text, date: date && Number.isFinite(Date.parse(date)) ? Date.parse(date) : Date.now()});
  }
  const title = html.match(/class="tgme_channel_info_header_title"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1];
  return {title: title ? decodeHtml(title) : `@${username}`, posts: posts.sort((a,b)=>a.messageId-b.messageId)};
}
