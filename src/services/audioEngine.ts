import { ChannelMessage, VoiceSettings } from '../types';

class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private isUnlocked: boolean = false;
  private queue: ChannelMessage[] = [];
  private isProcessingQueue: boolean = false;
  private onStatusChangeListeners: Array<(status: { isPlaying: boolean; currentMessage?: ChannelMessage; isAlert: boolean }) => void> = [];

  constructor() {
    // Lazy initialize on first user gesture
  }

  public async unlock(): Promise<boolean> {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new AudioContextClass();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        this.gainNode = this.audioCtx.createGain();
        this.gainNode.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
      }

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.isUnlocked = true;
      return true;
    } catch (e) {
      console.warn('AudioContext unlock failed:', e);
      return false;
    }
  }

  public isAudioUnlocked(): boolean {
    return this.isUnlocked && !!this.audioCtx && this.audioCtx.state === 'running';
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public subscribeStatus(listener: (status: { isPlaying: boolean; currentMessage?: ChannelMessage; isAlert: boolean }) => void) {
    this.onStatusChangeListeners.push(listener);
    return () => {
      this.onStatusChangeListeners = this.onStatusChangeListeners.filter((l) => l !== listener);
    };
  }

  private notifyStatus(isPlaying: boolean, currentMessage?: ChannelMessage, isAlert: boolean = false) {
    for (const listener of this.onStatusChangeListeners) {
      listener({ isPlaying, currentMessage, isAlert });
    }
  }

  public enqueueMessage(message: ChannelMessage, settings: VoiceSettings) {
    // If it's an urgent alert message, prioritize it to the front of queue!
    if (message.hasAlert) {
      this.queue.unshift(message);
    } else {
      this.queue.push(message);
    }

    if (!this.isProcessingQueue) {
      this.processQueue(settings);
    }
  }

  public clearQueue() {
    this.queue = [];
    this.stopCurrent();
  }

  public stopCurrent() {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // Ignored
      }
      this.currentSource = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.notifyStatus(false);
  }

  private async processQueue(settings: VoiceSettings) {
    if (this.queue.length === 0) {
      this.isProcessingQueue = false;
      this.notifyStatus(false);
      return;
    }

    this.isProcessingQueue = true;
    const currentMessage = this.queue.shift()!;
    this.notifyStatus(true, currentMessage, currentMessage.hasAlert);

    try {
      await this.playMessage(currentMessage, settings);
    } catch (err) {
      console.error('Error during message playback:', err);
    }

    // Small delay between posts
    await new Promise((r) => setTimeout(r, 400));
    this.processQueue(settings);
  }

  public async playMessage(message: ChannelMessage, settings: VoiceSettings): Promise<void> {
    await this.unlock();

    // 1. If using Gemini neural engine: ensure audio is synthesized with realistic human voice
    if (settings.engine === 'gemini') {
      if (!message.audioBase64) {
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: message.spokenText,
              voiceName: message.isNightMode ? settings.nightVoice : settings.voiceName,
              isAlert: message.hasAlert,
              isNight: message.isNightMode,
            }),
          });
          const data = await res.json();
          if (data.audioBase64) {
            message.audioBase64 = data.audioBase64;
          }
        } catch (fetchErr) {
          console.warn('On-demand Gemini neural TTS fetch failed:', fetchErr);
        }
      }

      if (message.audioBase64) {
        try {
          await this.playWavBase64(message.audioBase64, message.hasAlert, settings.alertVolumeBoost, settings);
          return;
        } catch (err) {
          console.warn('Gemini Audio playback error, falling back to browser speech:', err);
        }
      }
    }

    // 2. Fallback: Browser Speech Synthesis API
    await this.playBrowserTTS(message.spokenText, message.hasAlert, settings);
  }

  private async playWavBase64(base64: string, isAlert: boolean, alertBoost: number, settings: VoiceSettings): Promise<void> {
    if (!this.audioCtx || !this.gainNode) {
      throw new Error('AudioContext not ready');
    }

    // Convert base64 to ArrayBuffer
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer);

    return new Promise((resolve) => {
      if (!this.audioCtx || !this.gainNode) {
        resolve();
        return;
      }

      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;

      // Volume calculation:
      // If alert: very loud shouting boost (up to 350%)!
      // If night mode and NOT alert: quiet, gentle whisper (e.g. 25-30% volume)
      // Otherwise: normal volume 1.0
      let volumeLevel = 1.0;
      if (isAlert) {
        volumeLevel = Math.min(3.5, Math.max(1.5, alertBoost));
      } else if (settings.nightMode) {
        volumeLevel = Math.max(0.15, Math.min(0.5, settings.nightVolume || 0.28));
      }

      this.gainNode.gain.setValueAtTime(volumeLevel, this.audioCtx.currentTime);

      source.connect(this.gainNode);
      this.currentSource = source;

      source.onended = () => {
        if (this.currentSource === source) {
          this.currentSource = null;
        }
        resolve();
      };

      source.start(0);
    });
  }

  private playBrowserTTS(text: string, isAlert: boolean, settings: VoiceSettings): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        console.warn('speechSynthesis not supported');
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);

      // Try selecting a Russian voice if text contains Cyrillic (prefer natural/neural voices)
      const isRussian = /[а-яё]/i.test(text);
      const voices = window.speechSynthesis.getVoices();
      if (isRussian) {
        const ruVoices = voices.filter((v) => v.lang.startsWith('ru') || v.lang.includes('RU'));
        const bestVoice =
          ruVoices.find((v) => /natural|online|google|yandex|neural|premium|alisa|milena|yuri/i.test(v.name)) ||
          ruVoices.find((v) => !/espeak/i.test(v.name)) ||
          ruVoices[0];
        if (bestVoice) utterance.voice = bestVoice;
      }

      // Loudness & Voice controls
      if (isAlert) {
        // Break out of night mode: loud shout!
        utterance.volume = 1.0;
        utterance.rate = Math.min(1.6, Math.max(0.8, settings.speechRate * 1.15));
        utterance.pitch = Math.min(1.8, Math.max(0.6, 1.0 + (settings.pitch / 10) + 0.3));
      } else if (settings.nightMode) {
        // Quiet, gentle, soft bedtime voice
        utterance.volume = Math.max(0.15, Math.min(0.45, settings.nightVolume || 0.28));
        utterance.rate = Math.max(0.7, settings.speechRate * 0.88);
        utterance.pitch = Math.max(0.8, 0.95 + (settings.pitch / 10));
      } else {
        utterance.volume = 0.95;
        utterance.rate = settings.speechRate || 1.0;
        utterance.pitch = 1.0 + (settings.pitch / 10);
      }

      utterance.onend = () => {
        resolve();
      };

      utterance.onerror = (e) => {
        console.warn('SpeechSynthesis error:', e);
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }
}

export const audioEngine = new AudioEngine();
