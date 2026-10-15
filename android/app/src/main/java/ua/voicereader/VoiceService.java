package ua.voicereader;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.media.session.*;
import android.os.*;
import android.speech.tts.*;
import java.util.*;

public final class VoiceService extends Service {
    static final String SPEAK="ua.voicereader.SPEAK",STOP="ua.voicereader.STOP",TEST="ua.voicereader.TEST",PAUSE="ua.voicereader.PAUSE";
    static volatile boolean running=false;static volatile long startedAt=0;
    private TextToSpeech tts;private boolean ready=false,speaking=false,paused=false;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ArrayDeque<Speech> queue=new ArrayDeque<>();
    private final AudioAttributes attributes=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    private AudioManager audio;private AudioFocusRequest focus;private PowerManager.WakeLock wake;
    private MediaSession session;private String currentId="",currentTitle="Ожидание уведомлений";
    private static final String CHANNEL="reader_playback";
    static final class Speech {String title,text;boolean alert;Speech(String t,String s,boolean a){title=t;text=s;alert=a;}}
    @Override public void onCreate() {
        super.onCreate();startedAt=System.currentTimeMillis();running=true;
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"Фоновое чтение",NotificationManager.IMPORTANCE_LOW));
        session=new MediaSession(this,"VoiceReader");
        session.setCallback(new MediaSession.Callback(){@Override public void onPause(){pause();}@Override public void onPlay(){paused=false;drain();}@Override public void onStop(){stopSelf();}});
        session.setActive(true);publish();
        if(Build.VERSION.SDK_INT>=29)startForeground(1,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);else startForeground(1,notification());
        audio=getSystemService(AudioManager.class);
        focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attributes).setOnAudioFocusChangeListener(change->{if(change<0){pause();new Config(this).error("Чтение приостановлено: другой звук или звонок. Нажмите ▶ для продолжения.");}},main).build();
        wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"VoiceReader:Speech");wake.setReferenceCounted(false);
        tts=new TextToSpeech(this,status->main.post(()->{
            ready=status==TextToSpeech.SUCCESS;
            if(!ready){new Config(this).error("Системный синтез речи недоступен. Установите голос в настройках Android.");stopSelf();return;}
            tts.setAudioAttributes(attributes);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){
                @Override public void onStart(String id){}
                @Override public void onDone(String id){main.post(()->complete(id));}
                @Override public void onError(String id){main.post(()->{if(currentId.isEmpty()||!id.startsWith(currentId))return;new Config(VoiceService.this).error("Ошибка голоса: проверьте установленный язык TTS.");tts.stop();complete(currentId);});}
            });
            new Config(this).error("Чтение запущено. Экран можно выключить.");drain();
        }));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();
        if(STOP.equals(action)){stopSelf();return START_NOT_STICKY;}
        if(PAUSE.equals(action)){if(paused){paused=false;drain();publish();}else pause();return START_NOT_STICKY;}
        if(TEST.equals(action))enqueue("Проверка", "Срочно! Проверка чтения. После запуска можно выключить экран.");
        else if(SPEAK.equals(action)&&new Config(this).enabled())enqueue(intent.getStringExtra("title"),intent.getStringExtra("text"));
        return START_NOT_STICKY;
    }
    private void enqueue(String title,String text) {
        if(text==null||text.trim().isEmpty())return;
        Config config=new Config(this);List<String> matched=ReaderRules.matched(text,config.words());
        Speech item=new Speech(title,ReaderRules.spoken(text,matched),!matched.isEmpty());
        if(queue.size()>=20){queue.removeFirst();config.error("Очередь переполнена: старое уведомление пропущено.");}
        if(item.alert)queue.addFirst(item);else queue.addLast(item);drain();
    }
    private void drain() {
        if(!ready||paused||speaking||queue.isEmpty())return;
        if(audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED){new Config(this).error("Нет аудиофокуса. Нажмите ▶ после завершения другого звука.");paused=true;publish();return;}
        Speech item=queue.removeFirst();Config config=new Config(this);
        boolean night=config.night()&&!item.alert;
        String language=item.text.matches("(?s).*[іїєґІЇЄҐ].*")?"uk":item.text.matches("(?s).*[а-яА-ЯёЁ].*")?"ru":"en";
        int result=tts.setLanguage(Locale.forLanguageTag(language));
        if(result==TextToSpeech.LANG_MISSING_DATA||result==TextToSpeech.LANG_NOT_SUPPORTED){config.error("Установите системный голос языка "+language+" в настройках TTS.");audio.abandonAudioFocusRequest(focus);main.post(this::drain);return;}
        tts.setSpeechRate(config.rate()*(night?0.88f:item.alert?1.08f:1));tts.setPitch(config.pitch());
        List<String> parts=ReaderRules.chunks(item.text,Math.min(3000,TextToSpeech.getMaxSpeechInputLength()));
        speaking=true;currentTitle=item.title;currentId=UUID.randomUUID().toString();
        wake.acquire(10*60*1000L); // bounded per announcement; never hold a permanent wake lock
        main.postDelayed(watchdog,10*60*1000L);
        Bundle params=new Bundle();params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME,night?config.nightVolume():1f);
        for(int i=0;i<parts.size();i++) {
            int accepted=tts.speak(parts.get(i),TextToSpeech.QUEUE_ADD,params,i==parts.size()-1?currentId:currentId+"-"+i);
            if(accepted==TextToSpeech.ERROR){config.error("Не удалось поставить текст в очередь голоса.");tts.stop();complete(currentId);break;}
        }
        session.setMetadata(new android.media.MediaMetadata.Builder().putString(android.media.MediaMetadata.METADATA_KEY_TITLE,currentTitle).putString(android.media.MediaMetadata.METADATA_KEY_ARTIST,"Voice Reader").build());publish();
    }
    private final Runnable watchdog=()->{if(speaking){tts.stop();new Config(this).error("Озвучка превысила лимит времени и остановлена.");complete(currentId);}};
    private void complete(String id) {
        if(!id.equals(currentId))return;speaking=false;currentId="";main.removeCallbacks(watchdog);
        if(wake.isHeld())wake.release();audio.abandonAudioFocusRequest(focus);publish();drain();
    }
    private void pause() {
        paused=true;speaking=false;currentId="";if(tts!=null)tts.stop();main.removeCallbacks(watchdog);
        if(wake!=null&&wake.isHeld())wake.release();if(audio!=null&&focus!=null)audio.abandonAudioFocusRequest(focus);publish();
    }
    private void publish() {
        if(session!=null)session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_STOP).setState(paused?PlaybackState.STATE_PAUSED:speaking?PlaybackState.STATE_PLAYING:PlaybackState.STATE_STOPPED,0,1).build());
        getSystemService(NotificationManager.class).notify(1,notification());
    }
    private Notification notification() {
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,VoiceService.class).setAction(STOP),PendingIntent.FLAG_IMMUTABLE);
        PendingIntent pause=PendingIntent.getService(this,2,new Intent(this,VoiceService.class).setAction(PAUSE),PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("Voice Reader").setContentText(paused?"Чтение приостановлено":speaking?currentTitle:"Чтение включено • экран можно выключить").setContentIntent(open).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE).addAction(new Notification.Action.Builder(null,paused?"Продолжить":"Пауза",pause).build()).addAction(new Notification.Action.Builder(null,"Остановить",stop).build());
        if(session!=null)builder.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0,1));return builder.build();
    }
    @Override public void onDestroy(){running=false;new Config(this).prefs.edit().putBoolean("enabled",false).apply();main.removeCallbacksAndMessages(null);if(tts!=null){tts.stop();tts.shutdown();}if(wake!=null&&wake.isHeld())wake.release();if(audio!=null&&focus!=null)audio.abandonAudioFocusRequest(focus);if(session!=null){session.setActive(false);session.release();}stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
