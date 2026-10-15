import React, { useState } from 'react';
import { Terminal, Send, X, Sparkles, MessageSquare, AlertOctagon, HelpCircle } from 'lucide-react';
import { BotCommandLog } from '../types';

interface CommandSimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuteCommand: (cmd: string) => Promise<{ reply: string }>;
  onSimulatePost: (text: string, title?: string, username?: string) => Promise<void>;
  commandLogs: BotCommandLog[];
}

const SAMPLE_POSTS = [
  {
    label: '🚨 Срочно: Ликвидация позиций',
    title: 'Crypto Alert Feed',
    username: '@crypto_alerts_24',
    text: 'СРОЧНО! ВНИМАНИЕ! Произошла массовая ликвидация лонг-позиций на сумму более $250M. Зафиксирован резкий дамп рынка!',
  },
  {
    label: '⚡ Памп токена и пробой',
    title: 'Market Signal Insider',
    username: '@market_insider',
    text: 'Важно: на бирже обнаружен неожиданный памп токена. Объемы торгов выросли на 400% за 15 минут.',
  },
  {
    label: '📰 Обычный аналитический пост',
    title: 'Daily Tech Digest',
    username: '@tech_digest',
    text: 'Доброе утро! Европейские рынки открылись умеренным ростом. Индекс технологий прибавил полпроцента.',
  },
];

export const CommandSimulatorModal: React.FC<CommandSimulatorModalProps> = ({
  isOpen,
  onClose,
  onExecuteCommand,
  onSimulatePost,
  commandLogs,
}) => {
  const [activeTab, setActiveTab] = useState<'terminal' | 'post'>('terminal');
  const [commandInput, setCommandInput] = useState('');
  const [customPostText, setCustomPostText] = useState('');
  const [customChannelTitle, setCustomChannelTitle] = useState('Инсайдер Новости | Live');
  const [customChannelUsername, setCustomChannelUsername] = useState('@insider_channel');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;
    setLoading(true);
    await onExecuteCommand(commandInput.trim());
    setCommandInput('');
    setLoading(false);
  };

  const handleSendCustomPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPostText.trim()) return;
    setLoading(true);
    await onSimulatePost(customPostText.trim(), customChannelTitle, customChannelUsername);
    setCustomPostText('');
    setLoading(false);
  };

  const runQuickCommand = async (cmd: string) => {
    setLoading(true);
    await onExecuteCommand(cmd);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl text-slate-200">
        {/* Header */}
        <div className="p-4 px-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-950 text-sky-400 border border-sky-800/60">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Интерактивный Терминал и Симулятор</h2>
              <p className="text-xs text-slate-400">Управление ботом через команды и моделирование постов</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 p-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('terminal')}
            className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === 'terminal'
                ? 'bg-slate-800 text-sky-400 border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Команды Бота (/add, /remove, /list...)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('post')}
            className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === 'post'
                ? 'bg-slate-800 text-sky-400 border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Симулятор Поста Телеграм-Канала</span>
          </button>
        </div>

        {/* Tab 1: Bot Command Terminal */}
        {activeTab === 'terminal' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Quick Command Chips */}
            <div className="space-y-1.5">
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                Быстрые команды для проверки:
              </span>
              <div className="flex flex-wrap gap-2">
                {[
                  '/night',
                  '/night on',
                  '/channels',
                  '/channel add @bbbreaking',
                  '/list',
                  '/add внимание',
                  '/add ликвидация',
                  '/voice Zephyr',
                  '/voice Fenrir',
                  '/status',
                  '/help',
                ].map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => runQuickCommand(cmd)}
                    className="px-2.5 py-1 text-xs font-mono bg-slate-800/80 hover:bg-sky-950/80 hover:text-sky-300 text-slate-300 border border-slate-700/80 rounded-md transition-colors cursor-pointer"
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            </div>

            {/* Terminal Logs Window */}
            <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 font-mono text-xs space-y-3 min-h-[220px] max-h-[320px] overflow-y-auto">
              {commandLogs.length === 0 ? (
                <div className="text-slate-500 py-8 text-center font-sans">
                  Здесь отображаются ответы на команды бота. Попробуйте нажать <code className="text-sky-400">/list</code> или ввести команду ниже.
                </div>
              ) : (
                commandLogs.map((log, idx) => (
                  <div key={idx} className="space-y-1 pb-2 border-b border-slate-900 last:border-0">
                    <div className="flex items-center gap-2 text-slate-400">
                      <span className="text-sky-400 font-bold">&gt; {log.command}</span>
                      <span className="text-[10px] text-slate-600">({log.timestamp})</span>
                    </div>
                    <div className="text-slate-200 pl-4 whitespace-pre-wrap leading-relaxed">
                      {log.reply}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Command Input Form */}
            <form onSubmit={handleCommandSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="Введите команду бота (например: /add ликвидация, /voice Fenrir)"
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !commandInput.trim()}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Send className="w-4 h-4" />
                <span>Отправить</span>
              </button>
            </form>
          </div>
        )}

        {/* Tab 2: Channel Post Simulator */}
        {activeTab === 'post' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Preset Posts */}
            <div className="space-y-1.5">
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                Готовые образцы постов для моментальной проверки:
              </span>
              <div className="grid grid-cols-1 gap-2">
                {SAMPLE_POSTS.map((sample, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setCustomChannelTitle(sample.title);
                      setCustomChannelUsername(sample.username);
                      setCustomPostText(sample.text);
                    }}
                    className="p-3 text-left rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/70 transition-colors cursor-pointer"
                  >
                    <div className="font-semibold text-xs text-white mb-0.5">{sample.label}</div>
                    <p className="text-xs text-slate-400 line-clamp-1">{sample.text}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Post Form */}
            <form onSubmit={handleSendCustomPost} className="space-y-3 pt-2 border-t border-slate-800">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Название канала</label>
                  <input
                    type="text"
                    value={customChannelTitle}
                    onChange={(e) => setCustomChannelTitle(e.target.value)}
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Username канала</label>
                  <input
                    type="text"
                    value={customChannelUsername}
                    onChange={(e) => setCustomChannelUsername(e.target.value)}
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Текст сообщения канала</label>
                <textarea
                  rows={3}
                  value={customPostText}
                  onChange={(e) => setCustomPostText(e.target.value)}
                  placeholder="Напишите текст поста... Если в нем будет слово из фильтра, бот прокричит его 3 раза со знаками восклицания!"
                  className="w-full bg-slate-800/80 border border-slate-700 rounded-lg p-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !customPostText.trim()}
                className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-medium text-sm rounded-lg shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <AlertOctagon className="w-4 h-4" />
                <span>Опубликовать пост и озвучить моментально</span>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
