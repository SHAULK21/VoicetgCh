export interface ChannelMessage {
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

export type GeminiVoice = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface VoiceSettings {
  voiceName: GeminiVoice;
  speechRate: number;
  pitch: number;
  alertVolumeBoost: number;
  engine: 'gemini' | 'browser';
  autoSpeak: boolean;
  // Night Mode Settings
  nightMode: boolean;
  nightVolume: number; // e.g. 0.25 (quiet whisper)
  nightVoice: GeminiVoice; // e.g. 'Zephyr' (soft gentle voice)
  notify?: boolean;
}

export interface TrackedChannel {
  username: string; // clean username without @, e.g. "bbbreaking"
  title: string;
  lastPostId?: string;
  lastChecked?: number;
  error?: string;
  isActive: boolean;
  subscriberCount?: string;
}

export interface BotConfig {
  botUsername: string;
  botName: string;
  lastError: string;
  status: 'standby' | 'polling' | 'connected' | 'error';
}

export interface BotCommandLog {
  user: string;
  command: string;
  reply: string;
  timestamp: string;
}
