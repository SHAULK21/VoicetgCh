import React, { useState } from 'react';
import { BotConfig } from '../types';
import { Bot, CheckCircle, AlertCircle, X, Key, Send, HelpCircle, Power, RefreshCw } from 'lucide-react';

interface BotSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  botConfig: BotConfig;
  onConnectToken: (token: string) => Promise<boolean>;
  onStopPolling: () => void;
}

export const BotSetupModal: React.FC<BotSetupModalProps> = ({
  isOpen,
  onClose,
  botConfig,
  onConnectToken,
  onStopPolling,
}) => {
  const [tokenInput, setTokenInput] = useState(botConfig.token || '');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setLoading(true);
    setErrorMsg('');
    const success = await onConnectToken(tokenInput.trim());
    setLoading(false);
    if (!success) {
      setErrorMsg(botConfig.lastError || 'Не удалось подключиться к Telegram боту. Проверьте правильность токена.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 text-slate-200 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-950/70 text-sky-400 border border-sky-800/60">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Подключение Telegram Бота</h2>
              <p className="text-xs text-slate-400">Чтение каналов в реальном времени через Telegram Bot API</p>
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

        {/* Current Connection Status */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              botConfig.status === 'connected' || botConfig.status === 'polling'
                ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.7)] animate-pulse'
                : 'bg-amber-500'
            }`} />
            <div>
              <span className="text-xs text-slate-400 block">Статус связи:</span>
              <span className="text-sm font-semibold text-white">
                {botConfig.status === 'connected' || botConfig.status === 'polling'
                  ? `Подключен: @${botConfig.botUsername} (${botConfig.botName})`
                  : 'Ожидает токен бота'}
              </span>
            </div>
          </div>
          {botConfig.isPolling && (
            <button
              type="button"
              onClick={onStopPolling}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-950/80 hover:bg-red-900 border border-red-800/80 text-red-200 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Power className="w-3.5 h-3.5 text-red-400" />
              Отключить
            </button>
          )}
        </div>

        {/* Token Input Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400">
            Токен бота из @BotFather
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
              <Key className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
              className="w-full bg-slate-800/90 border border-slate-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
            />
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-950/60 border border-red-800/70 text-xs text-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !tokenInput.trim()}
            className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Проверка соединения...</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Запустить Polling Телеграм Бота</span>
              </>
            )}
          </button>
        </form>

        {/* Step-by-step Guide */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3 text-xs text-slate-300">
          <div className="flex items-center gap-2 font-semibold text-white">
            <HelpCircle className="w-4 h-4 text-sky-400" />
            <span>Как подключить бота к вашему каналу за 1 минуту:</span>
          </div>
          <ol className="list-decimal list-inside space-y-1.5 text-slate-400 leading-relaxed pl-1">
            <li>
              Откройте <b className="text-slate-200">@BotFather</b> в Telegram и отправьте команду <code className="text-sky-300 bg-slate-800 px-1 py-0.5 rounded">/newbot</code>.
            </li>
            <li>
              Задайте имя и юзернейм бота, скопируйте полученный <b className="text-slate-200">HTTP API Token</b> и вставьте в поле выше.
            </li>
            <li>
              Зайдите в настройки вашего <b className="text-slate-200">Телеграм Канала</b> → <b className="text-slate-200">Администраторы</b> → Нажмите <b className="text-slate-200">Добавить администратора</b> и найдите вашего созданного бота.
            </li>
            <li>
              Дайте боту разрешение <b className="text-sky-300">Публиковать сообщения</b> (чтобы бот получал события <code className="text-slate-200 bg-slate-800 px-1 py-0.5 rounded">channel_post</code>).
            </li>
            <li>
              Готово! Любой новый пост в канале будет сразу же прочитан вслух этой станцией!
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};
