import React, { useState } from 'react';
import { Filter, Plus, Trash2, AlertTriangle, Terminal, Sparkles, Check } from 'lucide-react';

interface FilterWordsPanelProps {
  filterWords: string[];
  onAddWord: (word: string) => void;
  onRemoveWord: (word: string) => void;
  onClearWords: () => void;
  onSetWords: (words: string[]) => void;
}

const PRESETS = [
  {
    name: '🚨 Экстренные оповещения',
    words: ['внимание', 'срочно', 'тревога', 'важно', 'экстренно', 'молния'],
  },
  {
    name: '📈 Крипта и Трейдинг',
    words: ['ликвидация', 'памп', 'дамп', 'листинг', 'шорт', 'пробой'],
  },
  {
    name: '🔥 Горячие Инфоповоды',
    words: ['breaking', 'взрыв', 'новость', 'заявление', 'санкции'],
  },
];

export const FilterWordsPanel: React.FC<FilterWordsPanelProps> = ({
  filterWords,
  onAddWord,
  onRemoveWord,
  onClearWords,
  onSetWords,
}) => {
  const [inputWord, setInputWord] = useState('');
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputWord.trim()) return;
    const splitWords = inputWord.split(',').map((w) => w.trim()).filter(Boolean);
    for (const w of splitWords) {
      onAddWord(w);
    }
    setInputWord('');
  };

  const copyCommand = (cmd: string) => {
    navigator.clipboard?.writeText(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-5 text-slate-200">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-red-400" />
          <h2 className="font-semibold text-white text-base">Фильтр Слов для Громкой Озвучки (3x)</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Активно:</span>
          <span className="font-mono font-bold text-red-400 bg-red-950/60 px-2 py-0.5 rounded border border-red-900/50">
            {filterWords.length} слов
          </span>
        </div>
      </div>

      {/* Explanatory callout */}
      <div className="bg-red-950/30 border border-red-900/40 rounded-lg p-3 text-xs text-red-200/90 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-white">Правило фильтра:</span> Если новое сообщение из телеграм-канала содержит любое из этих слов, бот мгновенно прокричит его <b>3 раза подряд громким голосом с знаками восклицания</b> и повышенной громкостью!
        </div>
      </div>

      {/* Add word form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputWord}
            onChange={(e) => setInputWord(e.target.value)}
            placeholder="Введите слово или несколько через запятую (например: ликвидация, памп)"
            className="w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg shadow-sm transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Добавить</span>
        </button>
      </form>

      {/* Preset Packs */}
      <div className="space-y-1.5">
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
          Быстрые тематические наборы
        </span>
        <div className="flex flex-wrap gap-2 pt-0.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => {
                const combined = Array.from(new Set([...filterWords, ...preset.words]));
                onSetWords(combined);
              }}
              className="px-2.5 py-1 text-xs bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700 rounded-md transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>{preset.name}</span>
            </button>
          ))}
          {filterWords.length > 0 && (
            <button
              type="button"
              onClick={onClearWords}
              className="px-2.5 py-1 text-xs bg-slate-800/60 hover:bg-red-950/60 text-slate-400 hover:text-red-300 border border-slate-800 hover:border-red-800/60 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ml-auto"
            >
              <Trash2 className="w-3 h-3" />
              <span>Очистить все</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Words Chips */}
      <div className="space-y-1.5">
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
          Текущий список слов
        </span>
        {filterWords.length === 0 ? (
          <div className="text-center py-6 text-slate-500 text-xs border border-dashed border-slate-800 rounded-lg">
            Список пуст. Добавьте слова вручную или выберите готовый набор выше.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-1">
            {filterWords.map((word) => (
              <span
                key={word}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-950/40 border border-red-800/60 text-red-200 text-xs font-mono group hover:border-red-600 transition-colors"
              >
                <span className="font-semibold">{word}</span>
                <span className="text-[10px] text-red-400/80">3x!</span>
                <button
                  type="button"
                  onClick={() => onRemoveWord(word)}
                  title="Удалить слово"
                  className="text-red-400/60 hover:text-red-300 transition-colors ml-0.5 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Telegram Bot Commands Reference */}
      <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5 font-medium text-slate-300">
            <Terminal className="w-3.5 h-3.5 text-sky-400" />
            <span>Управление списком через команды в самом Telegram:</span>
          </div>
          {copiedCmd && (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> Скопировано
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
          <div
            onClick={() => copyCommand('/add <слово>')}
            className="p-2 rounded bg-slate-900/90 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors"
          >
            <span className="text-sky-400 font-bold">/add &lt;слово&gt;</span>
            <span className="text-slate-400 block text-[11px] font-sans">Добавить новое слово в список</span>
          </div>
          <div
            onClick={() => copyCommand('/remove <слово>')}
            className="p-2 rounded bg-slate-900/90 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors"
          >
            <span className="text-sky-400 font-bold">/remove &lt;слово&gt;</span>
            <span className="text-slate-400 block text-[11px] font-sans">Удалить слово из фильтра</span>
          </div>
          <div
            onClick={() => copyCommand('/list')}
            className="p-2 rounded bg-slate-900/90 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors"
          >
            <span className="text-sky-400 font-bold">/list</span>
            <span className="text-slate-400 block text-[11px] font-sans">Посмотреть все слова в фильтре</span>
          </div>
          <div
            onClick={() => copyCommand('/clear')}
            className="p-2 rounded bg-slate-900/90 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors"
          >
            <span className="text-sky-400 font-bold">/clear</span>
            <span className="text-slate-400 block text-[11px] font-sans">Очистить весь список фильтра</span>
          </div>
        </div>
      </div>
    </div>
  );
};
