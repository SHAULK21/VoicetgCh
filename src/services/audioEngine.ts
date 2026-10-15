import {ChannelMessage,VoiceSettings} from '../types';
import {call} from './client';
type Status={isPlaying:boolean;currentMessage?:ChannelMessage;isAlert:boolean;error?:string};
type Entry={message:ChannelMessage;settings:VoiceSettings};
export class AudioEngine {
  private ctx:AudioContext|null=null;
  private gain:GainNode|null=null;
  private analyser:AnalyserNode|null=null;
  private source:AudioBufferSourceNode|null=null;
  private queue:Entry[]=[];
  private running=false;
  private generation=0;
  private resolveCurrent:(()=>void)|null=null;
  private listeners:Array<(s:Status)=>void>=[];
  public async unlock() {
    try {
      if(!this.ctx) {
        this.ctx=new (window.AudioContext||(window as any).webkitAudioContext)();
        this.gain=this.ctx.createGain();this.analyser=this.ctx.createAnalyser();this.analyser.fftSize=256;
        const compressor=this.ctx.createDynamicsCompressor();
        this.gain.connect(compressor);compressor.connect(this.analyser);this.analyser.connect(this.ctx.destination);
      }
      await this.ctx.resume();return this.ctx.state==='running';
    }catch{return false;}
  }
  public isAudioUnlocked(){return this.ctx?.state==='running';}
  public getAnalyser(){return this.analyser;}
  public subscribeStatus(listener:(s:Status)=>void) {this.listeners.push(listener);return ()=>{this.listeners=this.listeners.filter(l=>l!==listener);};}
  private status(s:Partial<Status>) {for(const listener of this.listeners) listener({isPlaying:false,isAlert:false,...s});}
  public enqueueMessage(message:ChannelMessage,settings:VoiceSettings) {
    const entry={message,settings:{...settings}};
    // Bound memory and report overload instead of reading stale hours-old posts.
    if(this.queue.length>=20) {const index=this.queue.findIndex(e=>!e.message.hasAlert);this.queue.splice(index<0?this.queue.length-1:index,1);this.status({error:'Очередь переполнена: старый пост пропущен. Он остаётся в ленте.'});}
    if(message.hasAlert)this.queue.unshift(entry);else this.queue.push(entry);
    void this.drain();
  }
  public stopCurrent() {
    this.generation++;this.queue=[];
    const resolve=this.resolveCurrent;this.resolveCurrent=null;
    try{this.source?.stop();}catch{}this.source=null;
    window.speechSynthesis?.cancel();resolve?.();
    this.status({});
  }
  public clearQueue(){this.stopCurrent();}
  private async drain() {
    if(this.running)return;this.running=true;
    try {
      while(this.queue.length) {
        const entry=this.queue.shift()!, generation=this.generation;
        this.status({isPlaying:true,currentMessage:entry.message,isAlert:entry.message.hasAlert});
        try {await this.play(entry,generation);} catch(e) {this.status({error:e instanceof Error?e.message:'Не удалось воспроизвести звук.'});}
      }
    }finally{this.running=false;this.status({});}
  }
  private async play(entry:Entry,generation:number) {
    const {message,settings}=entry;
    if(!await this.unlock())throw new Error('Нажмите «Включить звук», чтобы разрешить воспроизведение.');
    if(generation!==this.generation)return;
    if(settings.engine==='gemini') {
      try {
        const data=await call<{chunks:Array<{audioBase64:string;mimeType:string}>}>('tts',{text:message.spokenText,voiceName:message.isNightMode?settings.nightVoice:settings.voiceName,isAlert:message.hasAlert,isNight:message.isNightMode});
        for(const chunk of data.chunks) {
          if(generation!==this.generation)return;
          await this.playBytes(chunk,entry,generation);
        }
        return;
      }catch(e) {
        if(generation!==this.generation)return;
        this.status({isPlaying:true,currentMessage:message,isAlert:message.hasAlert,error:`${e instanceof Error?e.message:'Gemini недоступен.'} Используется системный голос.`});
      }
    }
    for(const text of splitSpeech(message.spokenText,1200)) {
      if(generation!==this.generation)return;
      await this.browserSpeech(text,entry);
    }
  }
  private async playBytes(chunk:{audioBase64:string;mimeType:string},entry:Entry,generation:number) {
    const bytes=Uint8Array.from(atob(chunk.audioBase64),c=>c.charCodeAt(0));
    let buffer:AudioBuffer;
    if(/audio\/(L16|pcm)/i.test(chunk.mimeType)) {
      const rate=Number(chunk.mimeType.match(/rate=(\d+)/i)?.[1]??24000);
      const view=new DataView(bytes.buffer);buffer=this.ctx!.createBuffer(1,Math.floor(bytes.length/2),rate);
      const output=buffer.getChannelData(0);for(let i=0;i<output.length;i++)output[i]=view.getInt16(i*2,true)/32768;
    }else buffer=await this.ctx!.decodeAudioData(bytes.buffer);
    if(generation!==this.generation)return;
    const {message,settings}=entry;
    this.gain!.gain.value=message.hasAlert?settings.alertVolumeBoost:message.isNightMode?settings.nightVolume:1;
    await new Promise<void>(resolve=>{
      const source=this.ctx!.createBufferSource();source.buffer=buffer;source.connect(this.gain!);this.source=source;
      let ended=false;const finish=()=>{if(ended)return;ended=true;source.disconnect();if(this.source===source)this.source=null;if(this.resolveCurrent===finish)this.resolveCurrent=null;resolve();};
      this.resolveCurrent=finish;source.onended=finish;source.start();
    });
  }
  private browserSpeech(text:string,{message,settings}:Entry) {
    if(!('speechSynthesis' in window))throw new Error('Системный голос недоступен на этом устройстве. Выберите Gemini.');
    return new Promise<void>((resolve,reject)=>{
      const utterance=new SpeechSynthesisUtterance(text);
      const lang=/[іїєґ]/i.test(text)?'uk-UA':/[а-яё]/i.test(text)?'ru-RU':'en-US';
      utterance.lang=lang;
      const voices=speechSynthesis.getVoices().filter(v=>v.lang.toLowerCase().startsWith(lang.slice(0,2)));
      const voice=voices.find(v=>/google|natural|online|neural/i.test(v.name))??voices[0];if(voice)utterance.voice=voice;
      utterance.rate=settings.speechRate*(message.isNightMode?0.88:message.hasAlert?1.08:1);
      utterance.pitch=1+settings.pitch/10;
      utterance.volume=message.isNightMode?settings.nightVolume:1;
      let ended=false;const finish=()=>{if(ended)return;ended=true;if(this.resolveCurrent===finish)this.resolveCurrent=null;resolve();};
      this.resolveCurrent=finish;utterance.onend=finish;utterance.onerror=e=>{if(e.error==='canceled'||e.error==='interrupted')finish();else{finish();this.status({error:`Системный голос: ${e.error}. Проверьте установленные языки.`});}};
      try{speechSynthesis.speak(utterance);}catch(e){finish();reject(e);}
    });
  }
}
export function splitSpeech(text:string,max:number) {
  const parts=[];let rest=text;
  while(rest.length>max){let end=rest.lastIndexOf(' ',max);if(end<max/2)end=max;if(/[\uD800-\uDBFF]/.test(rest[end-1]))end--;parts.push(rest.slice(0,end));rest=rest.slice(end);}if(rest)parts.push(rest);return parts;
}
export const audioEngine=new AudioEngine();
