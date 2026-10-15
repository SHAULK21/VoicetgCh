package ua.voicereader;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.media.session.*;
import android.os.*;
import android.speech.tts.*;
import java.util.*;

public final class VoiceService extends Service {
    static final String SPEAK="ua.voicereader.SPEAK",STOP="ua.voicereader.STOP",TEST="ua.voicereader.TEST",TEST_NORMAL="ua.voicereader.TEST_NORMAL",PAUSE="ua.voicereader.PAUSE";
    static volatile boolean running=false;static volatile long startedAt=0;
    private TextToSpeech tts;private boolean ready=false,speaking=false,destroyed=false;
    private final ReaderRules.PlaybackGate gate=new ReaderRules.PlaybackGate();
    private Speech currentSpeech;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ArrayDeque<Speech> queue=new ArrayDeque<>();
    private final AudioAttributes attributes=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    private AudioManager audio;private AudioFocusRequest focus;private PowerManager.WakeLock wake;
    private MediaSession session;private String currentId="",currentTitle="Очікування сповіщень";
    private static final String CHANNEL="reader_playback";
    static final class Speech {String title,text;boolean alert,plainPreview;Speech(String t,String s,boolean a,boolean preview){title=t;text=s;alert=a;plainPreview=preview;}}
    @Override public void onCreate() {
        super.onCreate();startedAt=System.currentTimeMillis();running=true;ReaderNotifications.seedBeforeReading();
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"Фонове читання",NotificationManager.IMPORTANCE_LOW));
        session=new MediaSession(this,"VoiceReader");
        session.setCallback(new MediaSession.Callback(){@Override public void onPause(){pause();}@Override public void onPlay(){gate.resume();drain();publish();}@Override public void onStop(){stopSelf();}});
        session.setActive(true);publish();
        if(Build.VERSION.SDK_INT>=29)startForeground(1,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);else startForeground(1,notification());
        audio=getSystemService(AudioManager.class);
        focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attributes).setAcceptsDelayedFocusGain(true).setOnAudioFocusChangeListener(change->{
            if(change==AudioManager.AUDIOFOCUS_GAIN){if(gate.focusGained()){drain();publish();}}
            else if(change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT||change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK){
                if(!gate.paused()){gate.waitForFocus();pausePlayback(false);new Config(this).error("Тимчасова пауза через інший звук. Читання відновиться автоматично.");}
            }else if(change==AudioManager.AUDIOFOCUS_LOSS){pause();new Config(this).error("Звук зайнятий іншою програмою. Натисніть «Запустити читання», щоб продовжити.");}
        },main).build();
        wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"VoiceReader:Speech");wake.setReferenceCounted(false);
        tts=new TextToSpeech(this,status->main.post(()->{
            if(destroyed)return;
            ready=status==TextToSpeech.SUCCESS;
            if(!ready){new Config(this).error("Системний синтез мовлення недоступний. Встановіть голос у налаштуваннях Android.");stopSelf();return;}
            tts.setAudioAttributes(attributes);
            if(!selectUkrainianVoice()){ready=false;new Config(this).error("Український голос відсутній. Відкрийте налаштування синтезу мовлення, встановіть українську мову та запустіть читання знову.");stopSelf();return;}
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){
                @Override public void onStart(String id){}
                @Override public void onDone(String id){main.post(()->complete(id));}
                @Override public void onError(String id){main.post(()->{if(currentId.isEmpty()||!id.startsWith(currentId))return;new Config(VoiceService.this).error("Помилка голосу: перевірте встановлену українську мову TTS.");tts.stop();complete(currentId);});}
            });
            new Config(this).error("Читання запущено українською. Екран можна вимкнути.");drain();
        }));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();
        if(STOP.equals(action)){stopSelf();return START_NOT_STICKY;}
        if(PAUSE.equals(action)){if(gate.paused()){gate.resume();drain();publish();}else pause();return START_NOT_STICKY;}
        if("START".equals(action)){gate.resume();drain();publish();}
        else if(TEST_NORMAL.equals(action)){
            gate.resume();enqueue("Звичайна гучність", "Це перевірка звичайної гучності читання та нічного режиму.",true);
        }
        else if(TEST.equals(action)) {
            gate.resume();
            Set<String> words=new Config(this).words();String keyword=words.isEmpty()?"":words.iterator().next();
            enqueue("Перевірка", "Перевірка українського голосу. "+(keyword.isEmpty()?"":"Ключове слово: "+keyword+". ")+"Після запуску можна вимкнути екран.");
        }
        else if(SPEAK.equals(action)&&new Config(this).enabled())enqueue(intent.getStringExtra("title"),intent.getStringExtra("text"));
        return START_NOT_STICKY;
    }
    private void enqueue(String title,String text){enqueue(title,text,false);}
    private void enqueue(String title,String text,boolean plainPreview) {
        if(text==null||text.trim().isEmpty())return;
        Config config=new Config(this);List<String> matched=plainPreview?Collections.emptyList():ReaderRules.matched(text,config.words());
        if(!plainPreview&&config.onlyKeywords()&&matched.isEmpty()){config.error("Збігів ключових фраз немає: повідомлення без звуку.");return;}
        Speech item=new Speech(title,text,!matched.isEmpty(),plainPreview);
        if(queue.size()>=20){queue.removeFirst();config.error("Чергу переповнено: старе сповіщення пропущено.");}
        if(item.alert)queue.addFirst(item);else queue.addLast(item);config.error(gate.waitingFocus()?"Очікуємо завершення іншого звуку; потім читання відновиться.":gate.paused()?"Читання на паузі. Натисніть ▶ у сповіщенні або «Запустити читання».":"Повідомлення в черзі озвучення.");drain();
    }
    private void drain() {
        if(!ready||gate.paused()||speaking||queue.isEmpty())return;
        Speech item=queue.peekFirst();Config config=new Config(this);boolean night=config.night();
        List<ReaderRules.Segment> parts=ReaderRules.speechPlan(item.text,item.plainPreview?Collections.emptyList():ReaderRules.matched(item.text,config.words()),config.loudKeywords(),!item.plainPreview&&config.onlyKeywords(),config.normalVolume(),config.alertVolume(),night,config.nightVolume(),Math.min(3000,TextToSpeech.getMaxSpeechInputLength()));
        if(parts.isEmpty()){queue.removeFirst();config.error("Збігів ключових фраз немає: повідомлення без звуку.");main.post(this::drain);return;}
        int focusResult=audio.requestAudioFocus(focus);
        if(focusResult!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED){
            if(focusResult==AudioManager.AUDIOFOCUS_REQUEST_DELAYED){gate.waitForFocus();config.error("Очікуємо звільнення звуку. Читання почнеться автоматично.");}
            else{gate.pause();config.error("Немає аудіофокуса. Натисніть «Запустити читання» після завершення іншого звуку.");}
            publish();return;
        }
        queue.removeFirst();tts.setSpeechRate(config.rate()*(night?0.88f:1));tts.setPitch(config.pitch());
        currentSpeech=item;speaking=true;currentTitle=item.title;currentId=UUID.randomUUID().toString();
        wake.acquire(10*60*1000L); // bounded per announcement; never hold a permanent wake lock
        main.postDelayed(watchdog,10*60*1000L);
        for(int i=0;i<parts.size();i++) {
            Bundle params=new Bundle();params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME,parts.get(i).volume);
            int accepted=tts.speak(parts.get(i).text,TextToSpeech.QUEUE_ADD,params,i==parts.size()-1?currentId:currentId+"-"+i);
            if(accepted==TextToSpeech.ERROR){config.error("Не вдалося додати текст до черги мовлення.");tts.stop();complete(currentId);break;}
        }
        session.setMetadata(new android.media.MediaMetadata.Builder().putString(android.media.MediaMetadata.METADATA_KEY_TITLE,currentTitle).putString(android.media.MediaMetadata.METADATA_KEY_ARTIST,"Voice Reader").build());publish();
    }
    private boolean selectUkrainianVoice() {
        // Prefer an installed offline Ukrainian voice. Never guess language from letters.
        Set<Voice> voices=tts.getVoices();Voice selected=null;
        if(voices!=null)for(Voice voice:voices) {
            if(!"uk".equals(voice.getLocale().getLanguage())||(voice.getFeatures()!=null&&voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)))continue;
            if(selected==null||selected.isNetworkConnectionRequired()&&!voice.isNetworkConnectionRequired()||selected.isNetworkConnectionRequired()==voice.isNetworkConnectionRequired()&&voice.getQuality()>selected.getQuality())selected=voice;
        }
        if(selected!=null&&tts.setVoice(selected)==TextToSpeech.SUCCESS)return true;
        if(tts.setLanguage(Locale.forLanguageTag("uk-UA"))<TextToSpeech.LANG_AVAILABLE)return false;
        Voice actual=tts.getVoice();return actual!=null&&"uk".equals(actual.getLocale().getLanguage());
    }
    private final Runnable watchdog=()->{if(speaking){tts.stop();new Config(this).error("Озвучення перевищило ліміт часу та зупинено.");complete(currentId);}};
    private void complete(String id) {
        if(!id.equals(currentId))return;speaking=false;currentSpeech=null;currentId="";main.removeCallbacks(watchdog);
        if(wake.isHeld())wake.release();audio.abandonAudioFocusRequest(focus);publish();drain();
    }
    private void pause(){gate.pause();pausePlayback(true);}
    private void pausePlayback(boolean abandonFocus) {
        if(currentSpeech!=null){if(queue.size()>=20)queue.removeLast();queue.addFirst(currentSpeech);currentSpeech=null;}
        speaking=false;currentId="";if(tts!=null)tts.stop();main.removeCallbacks(watchdog);
        if(wake!=null&&wake.isHeld())wake.release();if(abandonFocus&&audio!=null&&focus!=null)audio.abandonAudioFocusRequest(focus);publish();
    }
    private void publish() {
        if(session!=null)session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_STOP).setState(gate.paused()?PlaybackState.STATE_PAUSED:speaking?PlaybackState.STATE_PLAYING:PlaybackState.STATE_STOPPED,0,1).build());
        getSystemService(NotificationManager.class).notify(1,notification());
    }
    private Notification notification() {
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,VoiceService.class).setAction(STOP),PendingIntent.FLAG_IMMUTABLE);
        PendingIntent pause=PendingIntent.getService(this,2,new Intent(this,VoiceService.class).setAction(PAUSE),PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("Voice Reader").setContentText(gate.paused()?"Читання призупинено":speaking?currentTitle:"Читання ввімкнено • екран можна вимкнути").setContentIntent(open).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE).addAction(new Notification.Action.Builder(null,gate.paused()?"Продовжити":"Пауза",pause).build()).addAction(new Notification.Action.Builder(null,"Зупинити",stop).build());
        if(session!=null)builder.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0,1));return builder.build();
    }
    @Override public void onDestroy(){destroyed=true;running=false;new Config(this).prefs.edit().putBoolean("enabled",false).apply();main.removeCallbacksAndMessages(null);if(tts!=null){tts.stop();tts.shutdown();}if(wake!=null&&wake.isHeld())wake.release();if(audio!=null&&focus!=null)audio.abandonAudioFocusRequest(focus);if(session!=null){session.setActive(false);session.release();}stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
