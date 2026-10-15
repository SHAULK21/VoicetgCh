import React, { useState, useEffect } from 'react';
import { ChannelMessage, VoiceSettings, BotConfig, BotCommandLog, TrackedChannel } from './types';
import { audioEngine } from './services/audioEngine';
import { AudioVisualizer } from './components/AudioVisualizer';
import { VoiceSettingsPanel } from './components/VoiceSettingsPanel';
import { FilterWordsPanel } from './components/FilterWordsPanel';
import { ChannelFeed } from './components/ChannelFeed';
import { PublicChannelsPanel } from './components/PublicChannelsPanel';
import { BotSetupModal } from './components/BotSetupModal';
import { CommandSimulatorModal } from './components/CommandSimulatorModal';
import {
  Volume2,
  VolumeX,
  Radio,
  Bot,
  Terminal,
  Square,
  Moon,
  Sun,
  Zap,
  Globe,
  Feather,
} from 'lucide-react';

export default function App() {
  // State
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [filterWords, setFilterWords] = useState<string[]>([
    'внимание',
    'срочно',
    'тревога',
    'важно',
    'ликвидация',
    'памп',
  ]);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    voiceName: 'Kore',
    speechRate: 1.0,
    pitch: 0,
    alertVolumeBoost: 2.2,
    engine: 'gemini',
    autoSpeak: true,
    nightMode: false,
    nightVolume: 0.28,
    nightVoice: 'Zephyr',
  });
  const [trackedChannels, setTrackedChannels] = useState<TrackedChannel[]>([]);
  const [botConfig, setBotConfig] = useState<BotConfig>({
    token: '',
    botUsername: '',
    botName: '',
    isPolling: false,
    targetChannel: '@crypto_news_alerts',
    lastError: '',
    status: 'standby',
  });
  const [commandLogs, setCommandLogs] = useState<BotCommandLog[]>([]);

  // Audio Playback state
  const [isAudioReady, setIsAudioReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isAlertPlaying, setIsAlertPlaying] = useState<boolean>(false);
  const [currentMessage, setCurrentMessage] = useState<ChannelMessage | undefined>();

  // Modals
  const [isBotModalOpen, setIsBotModalOpen] = useState(false);
  const [isSimulatorModalOpen, setIsSimulatorModalOpen] = useState(false);

  // Audio status subscription
  useEffect(() => {
    const unsubscribe = audioEngine.subscribeStatus((status) => {
      setIsPlaying(status.isPlaying);
      setIsAlertPlaying(status.isAlert);
      setCurrentMessage(status.currentMessage);
    });
    return () => unsubscribe();
  }, []);

  // SSE Real-Time Sync
  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('init', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.botConfig) setBotConfig(data.botConfig);
        if (data.filterWords) setFilterWords(data.filterWords);
        if (data.voiceSettings) setVoiceSettings(data.voiceSettings);
        if (data.trackedChannels) setTrackedChannels(data.trackedChannels);
        if (data.history) setMessages(data.history);
      } catch (err) {
        console.error('Failed to parse init payload:', err);
      }
    });

    eventSource.addEventListener('new_post', (e: MessageEvent) => {
      try {
        const post: ChannelMessage = JSON.parse(e.data);
        setMessages((prev) => [post, ...prev.slice(0, 49)]);

        // Instant voice announcement!
        if (voiceSettings.autoSpeak) {
          audioEngine.enqueueMessage(post, voiceSettings);
          setIsAudioReady(true);
        }
      } catch (err) {
        console.error('Failed to parse new_post event:', err);
      }
    });

    eventSource.addEventListener('filter_updated', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.filterWords) setFilterWords(data.filterWords);
      } catch (err) {
        console.error('Failed to parse filter_updated event:', err);
      }
    });

    eventSource.addEventListener('settings_updated', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.voiceSettings) setVoiceSettings(data.voiceSettings);
      } catch (err) {
        console.error('Failed to parse settings_updated event:', err);
      }
    });

    eventSource.addEventListener('channels_updated', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (Array.isArray(data)) setTrackedChannels(data);
      } catch (err) {
        console.error('Failed to parse channels_updated event:', err);
      }
    });

    eventSource.addEventListener('bot_status', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setBotConfig(data);
      } catch (err) {
        console.error('Failed to parse bot_status event:', err);
      }
    });

    eventSource.addEventListener('bot_command_log', (e: MessageEvent) => {
      try {
        const data: BotCommandLog = JSON.parse(e.data);
        setCommandLogs((prev) => [data, ...prev.slice(0, 30)]);
      } catch (err) {
        console.error('Failed to parse bot_command_log event:', err);
      }
    });

    return () => {
      eventSource.close();
    };
  }, [voiceSettings]);

  // Audio Unlock Handler
  const handleUnlockAudio = async () => {
    const success = await audioEngine.unlock();
    if (success) {
      setIsAudioReady(true);
    }
  };

  // Stop currently playing speech
  const handleStopSpeech = () => {
    audioEngine.stopCurrent();
  };

  // Update Voice Settings
  const handleUpdateVoiceSettings = async (updated: Partial<VoiceSettings>) => {
    const next = { ...voiceSettings, ...updated };
    setVoiceSettings(next);
    try {
      await fetch('/api/bot/voice-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch (e) {
      console.error('Failed to save voice settings:', e);
    }
  };

  // Quick Night Mode Toggle
  const handleToggleNightMode = () => {
    handleUpdateVoiceSettings({ nightMode: !voiceSettings.nightMode });
  };

  // Public Channels handlers
  const handleAddChannel = async (username: string) => {
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (data.trackedChannels) setTrackedChannels(data.trackedChannels);
    } catch (e) {
      console.error('Error adding channel:', e);
    }
  };

  const handleRemoveChannel = async (username: string) => {
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(username)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.trackedChannels) setTrackedChannels(data.trackedChannels);
    } catch (e) {
      console.error('Error removing channel:', e);
    }
  };

  const handleToggleChannel = async (username: string) => {
    try {
      const res = await fetch('/api/channels/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (data.trackedChannels) setTrackedChannels(data.trackedChannels);
    } catch (e) {
      console.error('Error toggling channel:', e);
    }
  };

  const handleCheckChannelsNow = async (): Promise<number> => {
    try {
      const res = await fetch('/api/channels/check-now', {
        method: 'POST',
      });
      const data = await res.json();
      if (data.trackedChannels) setTrackedChannels(data.trackedChannels);
      return data.newPostsCount || 0;
    } catch (e) {
      console.error('Error checking channels:', e);
      return 0;
    }
  };

  // Filter words handlers
  const handleAddFilterWord = async (word: string) => {
    try {
      const res = await fetch('/api/bot/filter-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', word }),
      });
      const data = await res.json();
      if (data.filterWords) setFilterWords(data.filterWords);
    } catch (e) {
      console.error('Error adding filter word:', e);
    }
  };

  const handleRemoveFilterWord = async (word: string) => {
    try {
      const res = await fetch('/api/bot/filter-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', word }),
      });
      const data = await res.json();
      if (data.filterWords) setFilterWords(data.filterWords);
    } catch (e) {
      console.error('Error removing filter word:', e);
    }
  };

  const handleClearFilterWords = async () => {
    try {
      const res = await fetch('/api/bot/filter-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      });
      const data = await res.json();
      if (data.filterWords) setFilterWords(data.filterWords);
    } catch (e) {
      console.error('Error clearing filter words:', e);
    }
  };

  const handleSetFilterWords = async (words: string[]) => {
    try {
      const res = await fetch('/api/bot/filter-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set', words }),
      });
      const data = await res.json();
      if (data.filterWords) setFilterWords(data.filterWords);
    } catch (e) {
      console.error('Error setting filter words:', e);
    }
  };

  // Test voice directly with realistic Gemini neural speech
  const handleTestVoice = async (text: string, isAlert: boolean) => {
    await audioEngine.unlock();
    setIsAudioReady(true);

    let audioBase64: string | undefined = undefined;
    if (voiceSettings.engine === 'gemini') {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voiceName: voiceSettings.nightMode && !isAlert ? voiceSettings.nightVoice : voiceSettings.voiceName,
            isAlert,
            isNight: voiceSettings.nightMode && !isAlert,
          }),
        });
        const data = await res.json();
        if (data.audioBase64) {
          audioBase64 = data.audioBase64;
        }
      } catch (e) {
        console.error('Failed to fetch Gemini neural TTS:', e);
      }
    }

    const testMsg: ChannelMessage = {
      id: `test_${Date.now()}`,
      channelTitle: 'Тестовая Аудиопроверка',
      channelUsername: '@audio_test',
      text,
      date: Date.now(),
      hasAlert: isAlert,
      matchedWords: isAlert ? ['внимание', 'срочно'] : [],
      spokenText: text,
      audioBase64,
      timestamp: new Date().toLocaleTimeString('ru-RU'),
      isNightMode: voiceSettings.nightMode && !isAlert,
    };

    audioEngine.enqueueMessage(testMsg, voiceSettings);
  };

  // Replay a message from feed with realistic neural audio
  const handleReplayMessage = async (msg: ChannelMessage) => {
    await audioEngine.unlock();
    setIsAudioReady(true);

    if (!msg.audioBase64 && voiceSettings.engine === 'gemini') {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: msg.spokenText,
            voiceName: msg.isNightMode ? voiceSettings.nightVoice : voiceSettings.voiceName,
            isAlert: msg.hasAlert,
            isNight: msg.isNightMode,
          }),
        });
        const data = await res.json();
        if (data.audioBase64) {
          msg.audioBase64 = data.audioBase64;
        }
      } catch (e) {
        console.error('Failed to fetch TTS for replay:', e);
      }
    }

    audioEngine.enqueueMessage(msg, voiceSettings);
  };

  // Simulate quick posts
  const handleSimulateQuick = async (type: 'alert' | 'normal') => {
    const text =
      type === 'alert'
        ? 'СРОЧНО! ВНИМАНИЕ! Обнаружена внезапная ликвидация крупных позиций на бирже. Резкое падение котировок!'
        : 'Доброе утро! Подводим итоги торговой сессии: рынок демонстрирует умеренную волатильность.';

    try {
      await fetch('/api/bot/simulate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          channelTitle: type === 'alert' ? 'Crypto Flash Alerts | Live' : 'Market Overview Channel',
          channelUsername: type === 'alert' ? '@crypto_flash_live' : '@market_overview',
        }),
      });
    } catch (e) {
      console.error('Failed to simulate quick post:', e);
    }
  };

  // Bot Token Connection
  const handleConnectToken = async (token: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', token }),
      });
      const data = await res.json();
      if (data.botConfig) {
        setBotConfig(data.botConfig);
        return data.success;
      }
      return false;
    } catch (e) {
      console.error('Failed to connect token:', e);
      return false;
    }
  };

  const handleStopPolling = async () => {
    try {
      const res = await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      const data = await res.json();
      if (data.botConfig) setBotConfig(data.botConfig);
    } catch (e) {
      console.error('Failed to stop polling:', e);
    }
  };

  // Execute bot command in simulator
  const handleExecuteCommand = async (command: string) => {
    try {
      const res = await fetch('/api/bot/execute-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      if (data.filterWords) setFilterWords(data.filterWords);
      if (data.voiceSettings) setVoiceSettings(data.voiceSettings);
      if (data.trackedChannels) setTrackedChannels(data.trackedChannels);

      const logItem: BotCommandLog = {
        user: 'Simulator User',
        command,
        reply: data.reply,
        timestamp: new Date().toLocaleTimeString('ru-RU'),
      };
      setCommandLogs((prev) => [logItem, ...prev]);
      return { reply: data.reply };
    } catch (e) {
      console.error('Failed to execute command:', e);
      return { reply: 'Ошибка выполнения команды' };
    }
  };

  // Simulate custom post
  const handleSimulateCustomPost = async (text: string, title?: string, username?: string) => {
    try {
      await fetch('/api/bot/simulate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, channelTitle: title, channelUsername: username }),
      });
      setIsSimulatorModalOpen(false);
    } catch (e) {
      console.error('Failed to simulate custom post:', e);
    }
  };

  return (
    <div className={`min-h-screen text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white transition-colors duration-500 ${
      voiceSettings.nightMode ? 'bg-[#090b14]' : 'bg-slate-950'
    }`}>
      {/* Top Navbar */}
      <header className={`border-b sticky top-0 z-40 transition-colors duration-300 ${
        voiceSettings.nightMode
          ? 'border-indigo-900/60 bg-[#0d1020]/90 backdrop-blur-md'
          : 'border-slate-800 bg-slate-900/90 backdrop-blur-md'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo & Name */}
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-lg text-white transition-all ${
              voiceSettings.nightMode
                ? 'bg-gradient-to-br from-indigo-500 to-purple-700 shadow-indigo-500/20'
                : 'bg-gradient-to-br from-sky-500 to-blue-600 shadow-sky-500/20'
            }`}>
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                Telegram Voice Reader
                <span className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border ${
                  voiceSettings.nightMode
                    ? 'text-indigo-300 bg-indigo-950 border-indigo-800'
                    : 'text-sky-400 bg-sky-950 border-sky-800/80'
                }`}>
                  Live Channel Station
                </span>
              </h1>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Чтение каналов без прав админа</span>
                <span aria-hidden="true">·</span>
                <span className="text-red-400 font-medium">3x громкий крик по фильтру</span>
              </div>
            </div>
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center gap-2">
            {/* Quick Night Mode Switch in Header */}
            <button
              type="button"
              onClick={handleToggleNightMode}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                voiceSettings.nightMode
                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)]'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              <Moon className={`w-3.5 h-3.5 ${voiceSettings.nightMode ? 'text-amber-300 fill-amber-300' : 'text-slate-400'}`} />
              <span>{voiceSettings.nightMode ? 'Ночной режим: ВКЛ' : 'Ночной режим'}</span>
            </button>

            {/* Audio unlock / start button */}
            {!isAudioReady ? (
              <button
                type="button"
                onClick={handleUnlockAudio}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all cursor-pointer animate-bounce"
              >
                <Volume2 className="w-3.5 h-3.5" />
                Включить Звук
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleUpdateVoiceSettings({ autoSpeak: !voiceSettings.autoSpeak })}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  voiceSettings.autoSpeak
                    ? 'bg-emerald-950/60 border-emerald-600/70 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {voiceSettings.autoSpeak ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
                {voiceSettings.autoSpeak ? 'Авто-озвучка: ВКЛ' : 'Озвучка на паузе'}
              </button>
            )}

            {/* Bot Setup Button */}
            <button
              type="button"
              onClick={() => setIsBotModalOpen(true)}
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                botConfig.status === 'connected' || botConfig.status === 'polling'
                  ? 'bg-sky-950/70 border-sky-600 text-sky-200'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
            >
              <Bot className="w-3.5 h-3.5 text-sky-400" />
              <span>{botConfig.botUsername ? `@${botConfig.botUsername}` : 'Telegram Бот'}</span>
            </button>

            {/* Simulator & Terminal Button */}
            <button
              type="button"
              onClick={() => setIsSimulatorModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5 text-amber-400" />
              <span>Команды</span>
            </button>

            {/* Stop audio button if currently speaking */}
            {isPlaying && (
              <button
                type="button"
                onClick={handleStopSpeech}
                title="Остановить текущую речь"
                className="p-1.5 rounded-lg bg-red-600/90 hover:bg-red-500 text-white transition-colors cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 space-y-6 w-full">
        {/* Live Audio Status & Oscilloscope Bar */}
        <div className={`p-4 rounded-2xl border transition-all duration-300 ${
          isAlertPlaying
            ? 'bg-red-950/40 border-red-600 shadow-[0_0_30px_rgba(239,68,68,0.3)] ring-1 ring-red-500/50'
            : voiceSettings.nightMode
            ? 'bg-indigo-950/40 border-indigo-700/60 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
            : isPlaying
            ? 'bg-slate-900 border-sky-500/60 shadow-[0_0_20px_rgba(14,165,233,0.15)]'
            : 'bg-slate-900/80 border-slate-800'
        }`}>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${
                isAlertPlaying
                  ? 'bg-red-500 animate-ping'
                  : voiceSettings.nightMode
                  ? 'bg-indigo-400 animate-pulse'
                  : isPlaying
                  ? 'bg-sky-400 animate-pulse'
                  : 'bg-emerald-500'
              }`} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-white">
                    {isAlertPlaying
                      ? '🚨 ВНИМАНИЕ: СРАБОТАЛ ФИЛЬТР СЛОВ — ГРОМКИЙ КРИК 3 РАЗА!'
                      : voiceSettings.nightMode
                      ? '🌙 НОЧНОЙ РЕЖИМ АКТИВЕН: тихий нежный голос (громкий крик при алерте)'
                      : isPlaying
                      ? '🎙️ Голосовой эфир активен: чтение сообщения'
                      : '🟢 Станция активна — готова к мгновенной озвучке'}
                  </span>
                  <span className="text-xs text-slate-400">
                    · Голос: {voiceSettings.nightMode ? voiceSettings.nightVoice : voiceSettings.voiceName}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {currentMessage ? (
                    <span className="text-slate-300">
                      Читает пост из <b className="text-white">{currentMessage.channelTitle}</b>: "
                      {currentMessage.text.slice(0, 90)}..."
                    </span>
                  ) : (
                    <span>Моментально произносит любой поступивший в отслеживаемые каналы пост.</span>
                  )}
                </div>
              </div>
            </div>

            {/* Quick test buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTestVoice(
                  voiceSettings.nightMode
                    ? 'Спокойной ночи. Ночной тихий нежный диктор в эфире.'
                    : 'Внимание, проверка стандартного голоса.',
                  false
                )}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
                  voiceSettings.nightMode
                    ? 'bg-indigo-900/80 border-indigo-700 text-indigo-200 hover:bg-indigo-800'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                {voiceSettings.nightMode ? '🌙 Тест шёпота' : 'Тест голоса'}
              </button>
              <button
                type="button"
                onClick={() => handleSimulateQuick('alert')}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                Тест: 3x Громкий Крик!
              </button>
            </div>
          </div>

          {/* Visualizer Canvas */}
          <AudioVisualizer
            isPlaying={isPlaying}
            isAlert={isAlertPlaying}
            isNightMode={voiceSettings.nightMode}
          />
        </div>

        {/* 2-Column Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Public Channels & Live Channel Feed (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Public Channels Panel (NO ADMIN NEEDED) */}
            <PublicChannelsPanel
              channels={trackedChannels}
              onAddChannel={handleAddChannel}
              onRemoveChannel={handleRemoveChannel}
              onToggleChannel={handleToggleChannel}
              onCheckNow={handleCheckChannelsNow}
            />

            {/* Live Posts Feed */}
            <ChannelFeed
              messages={messages}
              currentPlayingId={currentMessage?.id}
              onReplay={handleReplayMessage}
              onSimulateQuick={handleSimulateQuick}
            />
          </div>

          {/* Right Column: Voice Settings (With Night Mode) & Filter Words (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Voice & Night Mode Settings Panel */}
            <VoiceSettingsPanel
              settings={voiceSettings}
              onChange={handleUpdateVoiceSettings}
              onTestVoice={handleTestVoice}
            />

            {/* Filter Words Panel */}
            <FilterWordsPanel
              filterWords={filterWords}
              onAddWord={handleAddFilterWord}
              onRemoveWord={handleRemoveFilterWord}
              onClearWords={handleClearFilterWords}
              onSetWords={handleSetFilterWords}
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/60 py-4 px-6 text-xs text-slate-500 text-center">
        Telegram Voice Reader &amp; Alert Bot · Общедоступные каналы без прав админа · Ночной нежный режим и 3x громкий крик по фильтру
      </footer>

      {/* Modals */}
      <BotSetupModal
        isOpen={isBotModalOpen}
        onClose={() => setIsBotModalOpen(false)}
        botConfig={botConfig}
        onConnectToken={handleConnectToken}
        onStopPolling={handleStopPolling}
      />

      <CommandSimulatorModal
        isOpen={isSimulatorModalOpen}
        onClose={() => setIsSimulatorModalOpen(false)}
        onExecuteCommand={handleExecuteCommand}
        onSimulatePost={handleSimulateCustomPost}
        commandLogs={commandLogs}
      />
    </div>
  );
}
