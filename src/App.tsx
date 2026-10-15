import React,{useState,useEffect,useRef} from 'react';
import {ChannelMessage,VoiceSettings,GeminiVoice,BotCommandLog,TrackedChannel} from './types';
import {call} from './services/client';
import {audioEngine} from './services/audioEngine';
import {DEFAULT_SETTINGS} from '../tgcloud/lib/domain.js';
import {AudioVisualizer} from './components/AudioVisualizer';
import {VoiceSettingsPanel} from './components/VoiceSettingsPanel';
import {FilterWordsPanel} from './components/FilterWordsPanel';
import {ChannelFeed} from './components/ChannelFeed';
import {PublicChannelsPanel} from './components/PublicChannelsPanel';
import {CommandSimulatorModal} from './components/CommandSimulatorModal';
import {Volume2,VolumeX,Radio,Square,Moon,Terminal,Download,RefreshCw} from 'lucide-react';
type Snapshot={messages:ChannelMessage[];cursor:number;filterWords:string[];voiceSettings:VoiceSettings;revision:number;trackedChannels:TrackedChannel[];ttsConfigured:boolean;botUsername:string};
export default function App() {
  const [messages,setMessages]=useState<ChannelMessage[]>([]),[words,setWords]=useState<string[]>([]),[channels,setChannels]=useState<TrackedChannel[]>([]);
  const [settings,setSettings]=useState<VoiceSettings>(DEFAULT_SETTINGS as VoiceSettings);
  const settingsRef=useRef(settings),cursor=useRef(0),started=useRef(false),revision=useRef(0),seen=useRef(new Set<string>()),mutation=useRef<Promise<any>>(Promise.resolve());
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[ready,setReady]=useState(false),[ttsConfigured,setConfigured]=useState(false),[key,setKey]=useState('');
  const [status,setStatus]=useState<{isPlaying:boolean;currentMessage?:ChannelMessage;isAlert:boolean}>({isPlaying:false,isAlert:false});
  const [simulator,setSimulator]=useState(false),[logs,setLogs]=useState<BotCommandLog[]>([]),[busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const isLocal=location.hostname==='localhost'||location.hostname==='127.0.0.1';
  function consume(data:Partial<Snapshot>,autoplay:boolean) {
    if(data.voiceSettings && (data.revision === undefined || data.revision >= revision.current)) {settingsRef.current=data.voiceSettings;setSettings(data.voiceSettings);}
    if(data.filterWords && (data.revision === undefined || data.revision >= revision.current))setWords(data.filterWords);if(data.trackedChannels)setChannels(data.trackedChannels);
    if(data.revision!==undefined)revision.current=Math.max(revision.current,data.revision);if(data.ttsConfigured!==undefined)setConfigured(data.ttsConfigured);
    if(data.messages) {
      const fresh=data.messages.filter(m=>!seen.current.has(m.id));
      for(const m of fresh) {seen.current.add(m.id);if(autoplay&&settingsRef.current.autoSpeak&&audioEngine.isAudioUnlocked())audioEngine.enqueueMessage(m,settingsRef.current);}
      setMessages(prev=>[...new Map([...prev,...data.messages!].map(m=>[m.id,m])).values()].sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,100));
      if(seen.current.size>500)seen.current=new Set(data.messages.map(m=>m.id));
    }
    if(data.cursor!==undefined)cursor.current=Math.max(cursor.current,data.cursor);
  }
  async function refresh(autoplay=false) {consume(await call<Snapshot>('getState'),autoplay);}
  // One subscription for the lifetime of the panel. Settings live in a ref;
  // receiving a fresh settings object cannot create a reconnect loop.
  useEffect(()=>{
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    window.Telegram?.WebApp?.ready?.();window.Telegram?.WebApp?.expand?.();
    const tick=async()=>{
      try {if(!cancelled&&(!document.hidden||!started.current)){const data=await call<Snapshot>('getState');if(!cancelled){consume(data,started.current);started.current=true;setLoading(false);}}}
      catch(e){if(!cancelled){setError(message(e));setLoading(false);}}
      finally{if(!cancelled)timer=setTimeout(tick,10000);}
    };
    void tick();const stop=audioEngine.subscribeStatus(s=>{setStatus(s);if(s.error)setError(s.error);});
    return ()=>{cancelled=true;clearTimeout(timer);stop();audioEngine.stopCurrent();};
  },[]);
  // Public checks run serially only while the panel is visible. Background
  // screen-off reading belongs to the Android companion, never a hidden timer.
  useEffect(()=>{
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    const tick=async()=>{try{if(!cancelled&&!document.hidden&&started.current){await call('checkChannels');if(!cancelled)await refresh(true);}}catch(e){if(!cancelled)setError(message(e));}finally{if(!cancelled)timer=setTimeout(tick,35000);}};
    timer=setTimeout(tick,1000);return ()=>{cancelled=true;clearTimeout(timer);};
  },[]);
  function message(e:unknown){return e instanceof Error?e.message:'Не удалось выполнить действие.';}
  // Serialize mutations so fast taps cannot overwrite each other's revisions.
  function change<T>(task:()=>Promise<T>):Promise<T> {
    const result=mutation.current.catch(()=>{}).then(async()=>{setBusy(true);setError('');try{return await task();}catch(e){setError(message(e));try{await refresh();}catch{}throw e;}finally{setBusy(false);}});
    mutation.current=result;return result;
  }
  const update=(patch:Partial<VoiceSettings>)=>{void change(async()=>{consume(await call('saveSettings',{settings:patch,revision:revision.current}),false);}).catch(()=>{});};
  const filter=(action:string,payload:object={})=>{void change(async()=>{consume(await call('filterWords',{action,...payload}),false);}).catch(()=>{});};
  const manage=(action:string,username:string)=>change(async()=>{consume(await call('manageChannel',{action,username}),false);});
  const check=()=>change(async()=>{const result=await call('checkChannels');consume(result,false);await refresh(true);return result.newPostsCount;});
  async function unlock(){const success=await audioEngine.unlock();setReady(success);if(!success)setError('Разрешите звук нажатием кнопки. Если звук недоступен внутри Telegram, используйте Android-компаньон.');}
  async function testVoice(text:string,alert:boolean,voice?:GeminiVoice) {
    await unlock();const selected={...settingsRef.current,...(voice?{voiceName:voice}: {})};
    audioEngine.enqueueMessage({id:`preview-${Date.now()}`,channelTitle:'Тест',channelUsername:'@test',text,spokenText:text,date:Date.now(),timestamp:'',hasAlert:alert,matchedWords:[],isNightMode:selected.nightMode&&!alert},selected);
  }
  function simulate(type:'alert'|'normal') {void change(async()=>{const text=type==='alert'?'СРОЧНО! ВНИМАНИЕ! Проверка тревожного сообщения.':'Обычная новость: проверка спокойного чтения.';consume(await call('simulatePost',{text,requestId:crypto.randomUUID(),after:cursor.current}),true);}).catch(()=>{});}
  function downloadConfig() {
    const config={version:1,filterWords:words,voiceSettings:settings,channels:channels.filter(c=>c.isActive).map(c=>({username:c.username,title:c.title})),notificationTitles:channels.filter(c=>c.isActive).map(c=>c.title)};
    const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='voice-reader-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    setNotice('Файл настроек создан. Импортируйте его в Android-компаньон. Если Telegram не сохранил файл, откройте панель во внешнем браузере или настройте приложение вручную.');
  }
  return <div className="min-h-screen bg-slate-950 text-slate-100 pb-24">
    <header className="sticky top-0 z-40 bg-slate-950/95 border-b border-slate-800 pt-[env(safe-area-inset-top)]">
      <div className="max-w-6xl mx-auto p-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-bold flex items-center gap-2"><Radio className="text-sky-400 w-5"/>Voice Reader</h1>
        <div className="flex gap-2 flex-wrap">
          <button className="control" onClick={()=>void unlock()}><Volume2 size={16}/>{ready?'Звук разрешён':'Включить звук'}</button>
          <button className="control" aria-pressed={settings.nightMode} onClick={()=>update({nightMode:!settings.nightMode})}><Moon size={16}/>Ночь {settings.nightMode?'вкл':'выкл'}</button>
          <button className="control" onClick={()=>setSimulator(true)}><Terminal size={16}/>Команды</button>
        </div>
      </div>
    </header>
    <main className="max-w-6xl mx-auto p-3 sm:p-6 space-y-5">
      {loading&&<p role="status">Загрузка личных настроек…</p>}
      {error&&<div role="alert" className="rounded-xl bg-red-950 border border-red-700 p-4 text-sm flex gap-3 justify-between"><span>{error}</span><button aria-label="Закрыть ошибку" onClick={()=>setError('')}>×</button></div>}
      {notice&&<p role="status" className="text-sm p-4 border border-sky-800 rounded-xl">{notice}</p>}
      {isLocal&&<p className="text-xs text-slate-400">Локальная проверка. Для доступа без Telegram запустите сервер с ALLOW_LOCAL_DEV=true.</p>}
      <section className="bg-sky-950/40 border border-sky-800 rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">📱 Читать с погашенным экраном</h2>
        <p className="text-sm text-slate-300">Установите Android-компаньон, разрешите доступ к уведомлениям и добавьте точные названия нужных Telegram-каналов. Нажмите «Запустить чтение» в приложении — после этого экран можно выключить.</p>
        <p className="text-xs text-slate-400">Бот не запускает голосовые автоматически в закрытом Telegram. Компаньон читает только текст доступных уведомлений системным голосом; Gemini используется в открытой панели. Названия каналов должны совпадать с заголовками уведомлений. Сопоставление выполняется по точному заголовку уведомления.</p>
        <button className="control" onClick={downloadConfig} disabled={loading}><Download size={16}/>Настройки для Android</button>
      </section>
      <section className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3">
        <div className="flex items-center justify-between gap-2"><p className="text-sm">{status.currentMessage?`Читается: ${status.currentMessage.channelTitle}`:'Ожидание новых сообщений'}</p>
          <button className="control" onClick={()=>update({autoSpeak:!settings.autoSpeak})}>{settings.autoSpeak?<Volume2 size={16}/>:<VolumeX size={16}/>}Авточтение {settings.autoSpeak?'вкл':'выкл'}</button>
          <button className="control" onClick={()=>audioEngine.stopCurrent()}><Square size={16}/>Стоп</button></div>
        <AudioVisualizer isPlaying={status.isPlaying} isAlert={status.isAlert} isNightMode={settings.nightMode}/>
      </section>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          <PublicChannelsPanel channels={channels} onAddChannel={n=>manage('add',n).then(()=>{})} onRemoveChannel={n=>manage('remove',n).then(()=>{}).catch(()=>{})} onToggleChannel={n=>manage('toggle',n).then(()=>{}).catch(()=>{})} onCheckNow={check}/>
          <ChannelFeed messages={messages} currentPlayingId={status.currentMessage?.id} onReplay={m=>{void unlock().then(()=>audioEngine.enqueueMessage(m,settingsRef.current));}} onSimulateQuick={simulate}/>
        </div>
        <div className="space-y-5">
          <VoiceSettingsPanel settings={settings} onChange={update} onTestVoice={(t,a,v)=>{void testVoice(t,a,v);}}/>
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <h2 className="font-semibold">Ключ Gemini {ttsConfigured?'✓ настроен':''}</h2>
            <p className="text-xs text-slate-400">Необязательно. Ключ хранится только на сервере и не возвращается в панель.</p>
            <form onSubmit={e=>{e.preventDefault();void change(async()=>{const result=await call('configureTts',{key});setKey('');setConfigured(result.ttsConfigured);}).catch(()=>{});}} className="flex flex-wrap gap-2">
              <input aria-label="Ключ Gemini" autoComplete="off" type="password" value={key} onChange={e=>setKey(e.target.value)} className="min-w-0 flex-1 bg-slate-800 p-3 rounded-lg" placeholder="Ключ Gemini"/>
              <button className="control" disabled={!key||busy}>Сохранить</button>
            </form>
            {ttsConfigured&&<button className="control" onClick={()=>{void change(async()=>{const result=await call('configureTts',{remove:true});setConfigured(result.ttsConfigured);}).catch(()=>{});}}>Удалить ключ</button>}
          </section>
          <FilterWordsPanel filterWords={words} onAddWord={word=>filter('add',{word})} onRemoveWord={word=>filter('remove',{word})} onClearWords={()=>filter('clear')} onSetWords={newWords=>filter('set',{words:newWords})}/>
        </div>
      </div>
    </main>
    <CommandSimulatorModal isOpen={simulator} onClose={()=>setSimulator(false)} commandLogs={logs} onExecuteCommand={command=>change(async()=>{const result=await call('executeCommand',{command});setLogs(prev=>[{user:'Вы',command,reply:result.reply,timestamp:new Date().toLocaleTimeString()},...prev].slice(0,50));await refresh();return result;}).catch(e=>({reply:message(e)}))} onSimulatePost={text=>change(async()=>{consume(await call('simulatePost',{text,requestId:crypto.randomUUID(),after:cursor.current}),true);setSimulator(false);}).catch(()=>{})}/>
    {busy&&<div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-sky-700 text-white p-3 text-xs flex items-center gap-2" role="status"><RefreshCw size={16} className="animate-spin"/>Сохранение…</div>}
  </div>;
}
