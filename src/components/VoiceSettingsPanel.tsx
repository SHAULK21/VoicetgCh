import React, { useState } from 'react';
import { GeminiVoice, VoiceSettings } from '../types';
import { Volume2, VolumeX, Sparkles, Sliders, Mic, Play, Radio, Moon, Sun, Feather, BellRing } from 'lucide-react';

interface VoiceSettingsPanelProps {
  settings: VoiceSettings;
  onChange: (updated: Partial<VoiceSettings>) => void;
  onTestVoice: (sampleText: string, isAlert: boolean) => void;
}

const VOICES: Array<{ id: GeminiVoice; label: string; desc: string; tag: string }> = [
  { id: 'Kore', label: 'Kore', desc: 'Четкий, глубокий, универсальный дикторский голос', tag: 'Рекомендуется' },
  { id: 'Fenrir', label: 'Fenrir', desc: 'Уверенный, низкий, командный тон для оповещений', tag: 'Громкий' },
  { id: 'Puck', label: 'Puck', desc: 'Энергичный, быстрый, новостной темп', tag: 'Динамичный' },
  { id: 'Charon', label: 'Charon', desc: 'Спокойный, авторитетный, размеренный', tag: 'Аналитика' },
  { id: 'Zephyr', label: 'Zephyr', desc: 'Мягкий, современный, идеален для ночного режима', tag: 'Нежный' },
];

export const VoiceSettingsPanel: React.FC<VoiceSettingsPanelProps> = ({ settings, onChange, onTestVoice }) => {
  const handleTest = (isAlert: boolean, isWhisper: boolean = false) => {
    if (isAlert) {
      onTestVoice('ВНИМАНИЕ! СРОЧНО! СРОЧНО! СРОЧНО! Зафиксировано экстренное сообщение!', true);
    } else if (isWhisper || settings.nightMode) {
      onTestVoice('Спокойной ночи. Новое тихое сообщение из телеграм-канала: ночные рынки стабильны.', false);
    } else {
      onTestVoice('В телеграм-канале опубликовано новое регулярное аналитическое сообщение.', false);
    }
  };

  return (
    <div className={`border rounded-xl p-5 space-y-6 text-slate-200 transition-all duration-300 ${
      settings.nightMode
        ? 'bg-indigo-950/40 border-indigo-800/80 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
        : 'bg-slate-900/90 border-slate-800'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-sky-400" />
          <h2 className="font-semibold text-white text-base">Настройка Синтеза Речи и Голоса</h2>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span>Gemini 3.8 Flash Lite TTS</span>
        </div>
      </div>

      {/* NIGHT MODE HIGHLIGHT CARD */}
      <div className={`p-4 rounded-xl border transition-all ${
        settings.nightMode
          ? 'bg-indigo-950/70 border-indigo-500 shadow-md ring-1 ring-indigo-500/40'
          : 'bg-slate-800/40 border-slate-700/60'
      }`}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-lg ${settings.nightMode ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-700 text-slate-300'}`}>
              <Moon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-white">Ночной режим (Тихий нежный голос)</span>
                {settings.nightMode && (
                  <span className="text-[10px] font-mono text-indigo-300 bg-indigo-900/80 px-2 py-0.5 rounded border border-indigo-700">
                    АКТИВЕН
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Сообщения читаются тихим, нежным голосом до появления ключевых фраз
              </p>
            </div>
          </div>

          {/* Toggle Switch */}
          <button
            type="button"
            onClick={() => onChange({ nightMode: !settings.nightMode })}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              settings.nightMode ? 'bg-indigo-600' : 'bg-slate-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                settings.nightMode ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Night mode detailed settings if active */}
        {settings.nightMode && (
          <div className="mt-3 pt-3 border-t border-indigo-900/50 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-indigo-200 flex items-center gap-1.5">
                <Feather className="w-3.5 h-3.5 text-indigo-400" />
                Громкость тихого шёпота:
              </span>
              <span className="font-mono text-indigo-300 font-bold">
                {Math.round((settings.nightVolume || 0.28) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.15"
              max="0.45"
              step="0.02"
              value={settings.nightVolume || 0.28}
              onChange={(e) => onChange({ nightVolume: parseFloat(e.target.value) })}
              className="w-full accent-indigo-400 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-indigo-400/80">
              <span>15% (Едва слышный шепот)</span>
              <span>28% (Рекомендуется)</span>
              <span>45% (Приглушенный)</span>
            </div>

            <div className="p-2 rounded bg-indigo-900/30 border border-indigo-800/40 text-[11px] text-indigo-200 flex items-center gap-2">
              <BellRing className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                При появлении слов из фильтра ночной режим <b>моментально прерывается</b> и слово громко кричится 3 раза!
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Engine Selection */}
      <div>
        <label className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2 block">
          Движок озвучки
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onChange({ engine: 'gemini' })}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              settings.engine === 'gemini'
                ? 'bg-sky-950/60 border-sky-500 text-sky-100 shadow-sm'
                : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-sky-400" />
              <span className="font-semibold text-sm">Gemini 3.8 Flash Lite</span>
            </div>
            <p className="text-xs text-slate-400 line-clamp-1">
              Качественный нейросетевой синтез речи высокого разрешения
            </p>
          </button>

          <button
            type="button"
            onClick={() => onChange({ engine: 'browser' })}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              settings.engine === 'browser'
                ? 'bg-sky-950/60 border-sky-500 text-sky-100 shadow-sm'
                : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Mic className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold text-sm">Browser Speech API</span>
            </div>
            <p className="text-xs text-slate-400 line-clamp-1">
              Нулевая задержка, системный встроенный синтезатор
            </p>
          </button>
        </div>
      </div>

      {/* Voice Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs uppercase tracking-wider font-semibold text-slate-300 block">
              Человеческие нейросетевые голоса (Без роботизации)
            </label>
            <span className="text-[11px] text-slate-400">
              Студийные голоса с живым дыханием и естественными интонациями
            </span>
          </div>
          <span className="text-xs text-sky-400 font-mono font-medium">Выбран: {settings.voiceName}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {VOICES.map((v) => {
            const isSelected = settings.voiceName === v.id;
            return (
              <div
                key={v.id}
                onClick={() => onChange({ voiceName: v.id })}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-sky-950/80 border-sky-400 text-white shadow-sm ring-1 ring-sky-500/50'
                    : 'bg-slate-800/50 border-slate-700/70 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">{v.label}</span>
                    <span className="text-[10px] text-sky-300/80 font-mono">{v.tag}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-snug">{v.desc}</p>
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-700/50 flex justify-end">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange({ voiceName: v.id });
                      onTestVoice(
                        v.id === 'Zephyr'
                          ? 'Здравствуйте. Это мягкий, нежный и спокойный голос, идеальный для ночи.'
                          : v.id === 'Fenrir'
                          ? 'Внимание! Это уверенный, низкий дикторский голос для срочных сообщений.'
                          : `Здравствуйте! Это живой дикторский голос ${v.label}. Чистая человеческая речь без роботов.`,
                        false
                      );
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 py-0.5 px-2 rounded bg-sky-950/60 hover:bg-sky-900/60 border border-sky-800/60 transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    <span>Послушать</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sliders: Rate, Pitch, Alert Volume Boost */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
        {/* Speed */}
        <div className="bg-slate-800/40 border border-slate-800 rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Скорость речи</span>
            <span className="font-mono text-sky-400 font-semibold">{settings.speechRate.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.75"
            max="1.75"
            step="0.05"
            value={settings.speechRate}
            onChange={(e) => onChange({ speechRate: parseFloat(e.target.value) })}
            className="w-full accent-sky-400 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>0.75x</span>
            <span>1.0x</span>
            <span>1.75x</span>
          </div>
        </div>

        {/* Pitch */}
        <div className="bg-slate-800/40 border border-slate-800 rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Тональность</span>
            <span className="font-mono text-sky-400 font-semibold">{settings.pitch > 0 ? `+${settings.pitch}` : settings.pitch}</span>
          </div>
          <input
            type="range"
            min="-5"
            max="5"
            step="1"
            value={settings.pitch}
            onChange={(e) => onChange({ pitch: parseInt(e.target.value, 10) })}
            className="w-full accent-sky-400 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>Низкий (-5)</span>
            <span>0</span>
            <span>Высокий (+5)</span>
          </div>
        </div>

        {/* Alert Loudness Multiplier */}
        <div className="bg-red-950/20 border border-red-900/40 rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-red-300 font-medium">Громкость Алертов</span>
            <span className="font-mono text-red-400 font-bold">{(settings.alertVolumeBoost * 100).toFixed(0)}% (+Gain)</span>
          </div>
          <input
            type="range"
            min="1.5"
            max="3.5"
            step="0.1"
            value={settings.alertVolumeBoost}
            onChange={(e) => onChange({ alertVolumeBoost: parseFloat(e.target.value) })}
            className="w-full accent-red-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>150%</span>
            <span>220%</span>
            <span>350% (Max)</span>
          </div>
        </div>
      </div>

      {/* Test Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="text-xs text-slate-400">
          Проверьте звучание голоса прямо сейчас:
        </div>
        <div className="flex items-center gap-2">
          {settings.nightMode ? (
            <button
              type="button"
              onClick={() => handleTest(false, true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-900 hover:bg-indigo-800 text-indigo-200 border border-indigo-700 transition-colors cursor-pointer"
            >
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              🌙 Тест нежного шёпота
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleTest(false, false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-sky-400" />
              Обычный голос
            </button>
          )}
          <button
            type="button"
            onClick={() => handleTest(true, false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white shadow-sm transition-colors cursor-pointer"
          >
            <Volume2 className="w-3.5 h-3.5 text-white" />
            🚨 Тест громкого крика (3 раза)
          </button>
        </div>
      </div>
    </div>
  );
};
