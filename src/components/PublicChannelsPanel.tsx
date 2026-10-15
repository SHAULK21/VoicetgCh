import React, { useState } from 'react';
import { TrackedChannel } from '../types';
import { Globe, Plus, Trash2, RefreshCw, Check, AlertCircle, ExternalLink, ShieldCheck, Zap } from 'lucide-react';

interface PublicChannelsPanelProps {
  channels: TrackedChannel[];
  onAddChannel: (username: string) => Promise<void>;
  onRemoveChannel: (username: string) => Promise<void>;
  onToggleChannel: (username: string) => Promise<void>;
  onCheckNow: () => Promise<number>;
}

const POPULAR_SUGGESTIONS = [{username:'durov',title:'Du Rove'}];

export const PublicChannelsPanel: React.FC<PublicChannelsPanelProps> = ({
  channels,
  onAddChannel,
  onRemoveChannel,
  onToggleChannel,
  onCheckNow,
}) => {
  const [inputVal, setInputVal] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    setLoading(true);
    try { await onAddChannel(inputVal.trim()); setInputVal(''); } catch {} finally { setLoading(false); }
  };

  const handleManualCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const newPosts = await onCheckNow();
      setCheckResult(newPosts > 0 ? `Найдено новых постов: ${newPosts}` : 'Проверка завершена. Смотрите статус каждого канала.');
    } catch {} finally { setChecking(false); }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-5 text-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <Globe className="w-5 h-5 text-sky-400" />
          <div>
            <h2 className="font-semibold text-white text-base">Общедоступные Telegram Каналы</h2>
            <p className="text-xs text-slate-400">Публичные страницы проверяются, пока панель открыта</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleManualCheck}
          disabled={checking}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${checking ? 'animate-spin' : ''}`} />
          <span>Проверить сейчас</span>
        </button>
      </div>

      {/* Info Callout */}
      <div className="bg-sky-950/30 border border-sky-800/40 rounded-lg p-3 text-xs text-sky-200/90 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-white">Вы не администратор? Без проблем!</span> Панель проверяет публичные посты на <code className="text-sky-300 bg-sky-950 px-1 py-0.5 rounded font-mono">t.me/s/канал</code> при открытом экране. Для чтения с погашенным экраном используйте Android-компаньон и уведомления Telegram.
        </div>
      </div>

      {checkResult && (
        <div className="p-2.5 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-xs text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{checkResult}</span>
        </div>
      )}

      {/* Add Channel Form */}
      <form onSubmit={handleAdd} className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Username или ссылка (например: @bbbreaking, t.me/shot_shot, durov)"
            className="w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !inputVal.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg shadow-sm transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Добавить</span>
        </button>
      </form>

      {/* Popular Suggestions */}
      <div className="space-y-1.5">
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
          Популярные открытые каналы в 1 клик:
        </span>
        <div className="flex flex-wrap gap-2">
          {POPULAR_SUGGESTIONS.map((sug) => {
            const isAdded = channels.some((c) => c.username.toLowerCase() === sug.username.toLowerCase());
            return (
              <button
                key={sug.username}
                type="button"
                disabled={isAdded}
                onClick={() => { void onAddChannel(sug.username).catch(() => {}); }}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer flex items-center gap-1.5 ${
                  isAdded
                    ? 'bg-slate-800/40 text-slate-500 border-slate-800 cursor-default'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                <span>{sug.title}</span>
                <span className="text-sky-400 text-[11px] font-mono">@{sug.username}</span>
                {isAdded && <Check className="w-3 h-3 text-emerald-400 ml-0.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Monitored Channels List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="uppercase tracking-wider font-semibold">Список каналов в эфире</span>
          <span>Всего: {channels.length}</span>
        </div>

        {channels.length === 0 ? (
          <div className="text-center py-6 text-slate-500 text-xs border border-dashed border-slate-800 rounded-lg">
            Нет добавленных каналов. Введите юзернейм любого канала выше.
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {channels.map((ch) => (
              <div
                key={ch.username}
                className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/80 flex items-center justify-between gap-3 hover:border-slate-600 transition-colors"
              >
                <div className="min-w-0 flex-1 break-words">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-white truncate">{ch.title || `@${ch.username}`}</span>
                    <a
                      href={`https://t.me/s/${ch.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-sky-400 transition-colors"
                      title="Открыть канал в Telegram"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                    <span className="font-mono text-sky-400">@{ch.username}</span>
                    {ch.subscriberCount && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-400">{ch.subscriberCount} читателей</span>
                      </>
                    )}
                    {ch.lastChecked && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[10px] text-slate-500">
                          Проверен {new Date(ch.lastChecked).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleChannel(ch.username)}
                    className={`px-2 py-1 text-xs rounded font-medium transition-colors cursor-pointer ${
                      ch.isActive
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {ch.isActive ? 'В эфире' : 'Пауза'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveChannel(ch.username)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700/50 transition-colors cursor-pointer"
                    title="Удалить из мониторинга"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
