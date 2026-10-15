import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../services/audioEngine';

interface AudioVisualizerProps {
  isPlaying: boolean;
  isAlert: boolean;
  isNightMode?: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isPlaying, isAlert, isNightMode }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const analyser = audioEngine.getAnalyser();

    const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 64);

    const render = () => {
      animationId = requestAnimationFrame(render);

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      if (analyser && isPlaying) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        // Subtle ambient idle breathing wave
        for (let i = 0; i < dataArray.length; i++) {
          dataArray[i] = isPlaying ? 120 : Math.sin(Date.now() / 300 + i * 0.2) * 6 + 10;
        }
      }

      const barCount = 42;
      const barWidth = (width / barCount) - 2;

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i % dataArray.length] || 0;
        const normalized = val / 255;
        const barHeight = Math.max(3, normalized * (height - 6));
        const x = i * (barWidth + 2);
        const y = height - barHeight;

        // Gradient based on alert state / night mode
        const gradient = ctx.createLinearGradient(0, height, 0, y);
        if (isAlert) {
          gradient.addColorStop(0, '#ef4444');
          gradient.addColorStop(0.6, '#f97316');
          gradient.addColorStop(1, '#fef08a');
        } else if (isPlaying && isNightMode) {
          gradient.addColorStop(0, '#4338ca');
          gradient.addColorStop(0.5, '#6366f1');
          gradient.addColorStop(1, '#c7d2fe');
        } else if (isPlaying) {
          gradient.addColorStop(0, '#0284c7');
          gradient.addColorStop(0.5, '#38bdf8');
          gradient.addColorStop(1, '#a7f3d0');
        } else if (isNightMode) {
          gradient.addColorStop(0, '#1e1b4b');
          gradient.addColorStop(1, '#312e81');
        } else {
          gradient.addColorStop(0, '#334155');
          gradient.addColorStop(1, '#475569');
        }

        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);

        // Top accent cap
        if (isPlaying) {
          ctx.fillStyle = isAlert ? '#ffffff' : isNightMode ? '#e0e7ff' : '#e0f2fe';
          ctx.fillRect(x, Math.max(0, y - 2), barWidth, 1.5);
        }
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isPlaying, isAlert, isNightMode]);

  return (
    <div className={`relative w-full h-16 rounded-lg overflow-hidden bg-slate-950/80 border transition-all duration-300 ${
      isAlert
        ? 'border-red-500/70 shadow-[0_0_25px_rgba(239,68,68,0.4)]'
        : isNightMode
        ? 'border-indigo-700/60 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
        : isPlaying
        ? 'border-sky-500/40 shadow-[0_0_15px_rgba(14,165,233,0.2)]'
        : 'border-slate-800'
    }`}>
      <canvas
        ref={canvasRef}
        width={560}
        height={64}
        className="w-full h-full block"
      />
      {isAlert ? (
        <div className="absolute top-2 right-3 flex items-center gap-1.5 text-xs font-mono font-bold text-red-400 animate-pulse">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
          ГРОМКИЙ АЛЕРТ: 3X ПОВТОРЕНИЕ
        </div>
      ) : isNightMode ? (
        <div className="absolute top-2 right-3 flex items-center gap-1.5 text-[11px] font-mono text-indigo-300">
          <span>🌙</span>
          <span>НОЧНОЙ РЕЖИМ (НЕЖНЫЙ ШЁПОТ)</span>
        </div>
      ) : null}
    </div>
  );
};
