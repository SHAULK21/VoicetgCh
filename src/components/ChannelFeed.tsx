import React from 'react';
import { ChannelMessage } from '../types';
import { Volume2, Play, AlertOctagon, CheckCircle2, MessageSquare, Send } from 'lucide-react';

interface ChannelFeedProps {
  messages: ChannelMessage[];
  currentPlayingId?: string;
  onReplay: (msg: ChannelMessage) => void;
  onSimulateQuick: (type: 'alert' | 'normal') => void;
}

export const ChannelFeed: React.FC<ChannelFeedProps> = ({
  messages,
  currentPlayingId,
  onReplay,
  onSimulateQuick,
}) => {
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 text-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <MessageSquare className="w-5 h-5 text-sky-400" />
          <h2 className="font-semibold text-white text-base">Лента Постов из Телеграм Канала</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSimulateQuick('normal')}
            className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-md transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Send className="w-3 h-3 text-sky-400" />
            + Обычный пост
          </button>
          <button
            type="button"
            onClick={() => onSimulateQuick('alert')}
            className="px-2.5 py-1 text-xs bg-red-950/70 hover:bg-red-900/80 text-red-200 border border-red-800/80 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 font-medium"
          >
            <AlertOctagon className="w-3 h-3 text-red-400" />
            + Пост с Алертом
          </button>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="text-center py-12 px-4 border border-dashed border-slate-800 rounded-xl space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center mx-auto text-slate-400">
            <Volume2 className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white text-sm">Ожидание сообщений из канала</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
              Как только в подключенном канале появится пост, бот моментально прочитает его вслух.
            </p>
          </div>
          <div className="pt-2 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => onSimulateQuick('alert')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer"
            >
              Смоделировать пост с алертом (3x крик)
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
          {messages.map((msg) => {
            const isPlayingThis = currentPlayingId === msg.id;

            return (
              <div
                key={msg.id}
                className={`p-4 rounded-xl border transition-all duration-300 relative ${
                  isPlayingThis
                    ? msg.hasAlert
                      ? 'bg-red-950/50 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]'
                      : 'bg-sky-950/40 border-sky-500 shadow-[0_0_15px_rgba(14,165,233,0.2)]'
                    : msg.hasAlert
                    ? 'bg-red-950/20 border-red-900/60 hover:border-red-700/80'
                    : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Header: Channel info and timestamp */}
                <div className="flex flex-wrap gap-2 items-center justify-between text-xs text-slate-400 mb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">{msg.channelTitle}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-sky-400 font-mono">{msg.channelUsername}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-400">{new Date(msg.date).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}</span>
                    {isPlayingThis && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-sky-400 animate-pulse">
                        <Volume2 className="w-3.5 h-3.5" /> В эфире
                      </span>
                    )}
                  </div>
                </div>

                {/* Alert Notification Header */}
                {msg.hasAlert && (
                  <div className="mb-2.5 p-2 rounded-lg bg-red-950/70 border border-red-800/70 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-red-200">
                      <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
                      <span className="font-semibold">Сработал фильтр слов:</span>
                      <span className="font-mono font-bold text-red-300 underline">
                        {msg.matchedWords.join(', ')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono uppercase bg-red-600 text-white font-bold px-1.5 py-0.5 rounded">
                      Громко 3x!
                    </span>
                  </div>
                )}

                {/* Message Body */}
                <div className="text-sm text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                  {highlightMatchedWords(msg.text, msg.matchedWords)}
                </div>

                {/* Spoken Alert Exclamation Preview */}
                {msg.hasAlert && (
                  <div className="mt-2.5 pt-2 border-t border-red-900/40 text-xs font-mono text-red-300/90 bg-red-950/30 p-2 rounded">
                    <span className="text-slate-400 font-sans block text-[10px] mb-0.5">Озвучено диктором в эфир:</span>
                    <span className="font-bold text-red-400">
                      {msg.spokenText.split('\n\n')[0]}
                    </span>
                  </div>
                )}

                {/* Action buttons */}
                <div className="mt-3 flex flex-wrap gap-2 items-center justify-between pt-2 border-t border-slate-800/60">
                  <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    {msg.hasAlert ? (
                      <span className="text-red-400 font-medium">🚨 Максимальная громкость + Gain Boost (3x крик!)</span>
                    ) : msg.isNightMode ? (
                      <span className="text-indigo-300 font-medium flex items-center gap-1">🌙 Озвучено нежным тихим шёпотом</span>
                    ) : (
                      <span>🎙️ Стандартная дикторская озвучка</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onReplay(msg)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                  >
                    <Play className="w-3 h-3 text-sky-400" />
                    <span>Повторить озвучку</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Helper function to highlight matched words inside the post
function highlightMatchedWords(text: string, matchedWords: string[]): React.ReactNode {
  if (!matchedWords || matchedWords.length === 0) {
    return text;
  }

  // Create regex pattern for all matched words
  const escaped = matchedWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, index) => {
    const isMatch = matchedWords.some((w) => w.toLowerCase() === part.toLowerCase());
    if (isMatch) {
      return (
        <mark
          key={index}
          className="bg-red-500/30 text-red-300 font-bold px-1 rounded border border-red-500/50"
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}
