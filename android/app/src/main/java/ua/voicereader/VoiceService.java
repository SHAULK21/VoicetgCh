package ua.voicereader;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.media.session.*;
import android.os.*;
import android.speech.tts.*;
import java.util.*;
import java.io.*;

public class VoiceService extends Service {
    static final String SPEAK="ua.voicereader.SPEAK",STOP="ua.voicereader.STOP",TEST="ua.voicereader.TEST",TEST_NORMAL="ua.voicereader.TEST_NORMAL",PAUSE="ua.voicereader.PAUSE";
    static volatile boolean running=false;static volatile long startedAt=0;
    private TextToSpeech tts;private boolean ready=false,speaking=false,destroyed=false,synthesizing=false,playerReady=false;
    private MediaPlayer player;private File audioFile;
    private boolean focusRequested,focusHeld,focusRetryPending;private long focusRetryDelay=2000;
    private final ReaderRules.PlaybackGate gate=new ReaderRules.PlaybackGate();
    private Speech currentSpeech;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ArrayDeque<Speech> queue=new ArrayDeque<>();
    private final ReaderRules.Recent deliveries=new ReaderRules.Recent(200);
    private final AudioAttributes attributes=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    private AudioManager audio;private AudioFocusRequest focus;private PowerManager.WakeLock wake;
    private MediaSession session;private String currentId="",currentTitle="Очікування сповіщень";
    private static final String CHANNEL="reader_playback";
    static final class Speech {String title,text;boolean alert,plainPreview,testPreview;List<ReaderRules.Segment> plan;int segment;float rate,pitch;Speech(String t,String s,boolean a,boolean plain,boolean test){title=t;text=s;alert=a;plainPreview=plain;testPreview=test;}}
    @Override public void onCreate() {
        super.onCreate();recordServiceEvent("Службу запущено");startedAt=System.currentTimeMillis();running=true;ReaderNotifications.seedBeforeReading();if(new Config(this).enabled()&&!ReaderNotifications.connected())ReaderNotifications.reconnect(this);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"Фонове читання",NotificationManager.IMPORTANCE_LOW));
        session=new MediaSession(this,"VoiceReader");
        session.setCallback(new MediaSession.Callback(){@Override public void onPause(){pause();}@Override public void onPlay(){resumeReading();}@Override public void onStop(){stopByUser();}});
        session.setActive(true);publish();
        if(Build.VERSION.SDK_INT>=29)startForeground(1,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);else startForeground(1,notification());
        configureAudio();
        // Only our private, temporary synthesis files can remain after a process crash.
        File[] stale=getCacheDir().listFiles((dir,name)->name.startsWith("voice-reader-")&&name.endsWith(".wav"));
        if(stale!=null)for(File file:stale)file.delete();
        wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"VoiceReader:Speech");wake.setReferenceCounted(false);
        tts=new TextToSpeech(this,status->main.post(()->{
            if(destroyed)return;
            ready=status==TextToSpeech.SUCCESS;
            if(!ready){new Config(this).error("Системний синтез мовлення недоступний. Встановіть голос у налаштуваннях Android.");stopAfterVoiceFailure();return;}
            tts.setAudioAttributes(attributes);
            if(!selectUkrainianVoice()){ready=false;new Config(this).error("Український голос відсутній. Відкрийте налаштування синтезу мовлення, встановіть українську мову та запустіть читання знову.");stopAfterVoiceFailure();return;}
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){
                @Override public void onStart(String id){}
                @Override public void onDone(String id){main.post(()->prepareAudio(id));}
                @Override public void onError(String id){main.post(()->{if(id.equals(currentId))failCurrent("Помилка синтезу українського мовлення.");});}
                @Override public void onStop(String id,boolean interrupted){main.post(()->{if(id.equals(currentId)&&synthesizing)failCurrent("Синтезатор перервав підготовку голосу. Наступні повідомлення продовжать читатися.");});}
            });
            new Config(this).error("Читання запущено українською. Екран можна вимкнути.");drain();
        }));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if(intent!=null&&STOP.equals(intent.getAction())){stopByUser();return START_NOT_STICKY;}
        // 'enabled' is the user's choice, not the current process/service state.
        if(!new Config(this).enabled()){stopSelf();return START_NOT_STICKY;}
        if(intent==null){recordServiceEvent("Android відновив службу після завершення процесу");return START_STICKY;}
        String action=intent.getAction();
        if(PAUSE.equals(action)){if(gate.paused()&&!gate.waitingFocus())resumeReading();else pause();return START_STICKY;}
        if("START".equals(action))resumeReading();
        else if(TEST_NORMAL.equals(action)){
            resumeReading();enqueue("Звичайна гучність", "Це перевірка звичайної гучності читання та нічного режиму.",true,true);
        }
        else if(TEST.equals(action)) {
            resumeReading();
            Set<String> words=new Config(this).words();String keyword=words.isEmpty()?"":words.iterator().next();
            enqueue("Перевірка", "Перевірка українського голосу. "+(keyword.isEmpty()?"":"Ключове слово: "+keyword+". ")+"Після запуску можна вимкнути екран.",false,true);
        }
        else if(SPEAK.equals(action)&&new Config(this).enabled()){
            String delivery=intent.getStringExtra("delivery_id");
            if(delivery==null||deliveries.add(delivery))enqueue(intent.getStringExtra("title"),intent.getStringExtra("text"));
            else new Config(this).error("Повторну доставку того самого повідомлення пропущено.");
        }
        return START_STICKY;
    }
    private void recordServiceEvent(String event){new Config(this).prefs.edit().putString("service_event",event).putLong("service_event_at",System.currentTimeMillis()).apply();}
    private void stopByUser(){new Config(this).prefs.edit().putBoolean("enabled",false).apply();recordServiceEvent("Зупинено користувачем");stopSelf();}
    private void stopAfterVoiceFailure(){new Config(this).prefs.edit().putBoolean("enabled",false).apply();recordServiceEvent("Зупинено: синтезатор українського мовлення недоступний");stopSelf();}
    private void enqueue(String title,String text){enqueue(title,text,false,false);}
    private void enqueue(String title,String text,boolean plainPreview,boolean testPreview) {
        if(text==null||text.trim().isEmpty())return;
        Config config=new Config(this);
        if(!testPreview&&config.tooLong(text)){config.error(config.lengthSkipReason());return;}
        List<String> matched=plainPreview?Collections.emptyList():ReaderRules.matched(text,config.words());
        if(!plainPreview&&config.onlyKeywords()&&matched.isEmpty()){config.error("Збігів ключових фраз немає: повідомлення без звуку.");return;}
        Speech item=new Speech(title,text,!matched.isEmpty(),plainPreview,testPreview);
        if(queue.size()>=20){queue.removeFirst();config.error("Чергу переповнено: старе сповіщення пропущено.");}
        if(item.alert)queue.addFirst(item);else queue.addLast(item);if(gate.waitingFocus()&&!focusRequested)scheduleFocusRetry(focusRetryDelay);config.error(gate.waitingFocus()?"Очікуємо завершення іншого звуку; потім читання відновиться.":gate.paused()?"Читання на паузі. Натисніть ▶ у сповіщенні або «Запустити читання».":"Повідомлення в черзі озвучення.");drain();
    }
    private void configureAudio(){
        audio=getSystemService(AudioManager.class);
        focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attributes)
            .setAcceptsDelayedFocusGain(true).setWillPauseWhenDucked(true).setOnAudioFocusChangeListener(this::audioFocusChanged,main).build();
    }
    private void audioFocusChanged(int change){
        if(destroyed||!new Config(this).enabled()||!focusRequested)return;
        if(change==AudioManager.AUDIOFOCUS_GAIN){
            if(gate.paused()&&!gate.waitingFocus()){abandonFocus();return;}
            focusHeld=true;cancelFocusRetry();focusRetryDelay=2000;gate.focusGained();drain();publish();
        }else if(change==AudioManager.AUDIOFOCUS_LOSS||change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT||change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK){
            if(gate.paused()&&!gate.waitingFocus())return;
            focusHeld=false;gate.waitForFocus();pausePlayback(change==AudioManager.AUDIOFOCUS_LOSS);
            // A permanent loss has no later GAIN callback. Retry while work is pending.
            scheduleFocusRetry(change==AudioManager.AUDIOFOCUS_LOSS?focusRetryDelay:30000);
            new Config(this).error("Очікуємо звільнення звуку. Читання продовжиться автоматично з поточної позиції.");publish();
        }
    }
    private final Runnable retryFocus=()->{
        focusRetryPending=false;
        if(destroyed||!new Config(this).enabled()||!gate.waitingFocus()||currentSpeech==null&&queue.isEmpty())return;
        abandonFocus();gate.resume();drain();publish();
    };
    private void scheduleFocusRetry(long delay){
        if(focusRetryPending||destroyed||!new Config(this).enabled()||currentSpeech==null&&queue.isEmpty())return;
        focusRetryPending=true;main.postDelayed(retryFocus,delay);
    }
    private void cancelFocusRetry(){main.removeCallbacks(retryFocus);focusRetryPending=false;}
    private void abandonFocus(){focusHeld=false;boolean requested=focusRequested;focusRequested=false;if(requested&&audio!=null&&focus!=null)audio.abandonAudioFocusRequest(focus);}
    private void resumeReading(){cancelFocusRetry();focusRetryDelay=2000;gate.resume();drain();publish();}
    private void drain() {
        if(destroyed||!ready||gate.paused()||speaking)return;
        Config config=new Config(this);
        if(currentSpeech==null){
            if(queue.isEmpty())return;
            Speech item=queue.removeFirst();
            if(!item.testPreview&&config.tooLong(item.text)){config.error(config.lengthSkipReason());main.post(this::drain);return;}
            item.plan=ReaderRules.speechPlan(item.text,item.plainPreview?Collections.emptyList():ReaderRules.matched(item.text,config.words()),config.loudKeywords(),!item.plainPreview&&config.onlyKeywords(),config.normalVolume(),config.alertVolume(),config.night(),config.nightVolume(),Math.min(3000,TextToSpeech.getMaxSpeechInputLength()));
            if(item.plan.isEmpty()){config.error("Збігів ключових фраз немає: повідомлення без звуку.");main.post(this::drain);return;}
            item.rate=config.rate()*(config.night()?0.88f:1);item.pitch=config.pitch();currentSpeech=item;currentTitle=item.title;
        }
        if(synthesizing)return;
        if(player==null){synthesizeSegment();return;}
        if(!playerReady)return;
        if(!focusHeld){
            if(focusRequested)abandonFocus();
            int result=audio.requestAudioFocus(focus);focusRequested=result!=AudioManager.AUDIOFOCUS_REQUEST_FAILED;focusHeld=result==AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            if(!focusHeld){
                gate.waitForFocus();releaseCpu();scheduleFocusRetry(result==AudioManager.AUDIOFOCUS_REQUEST_DELAYED?30000:focusRetryDelay);
                focusRetryDelay=Math.min(30000,focusRetryDelay*2);config.error("Звук тимчасово недоступний. Очікуємо та продовжимо автоматично.");publish();return;
            }
        }
        cancelFocusRetry();focusRetryDelay=2000;
        try{
            float volume=currentSpeech.plan.get(currentSpeech.segment).volume;player.setVolume(volume,volume);
            // MediaPlayer.pause/start retains the exact audio position; never resynthesize a paused body.
            player.start();speaking=true;holdCpu();config.error("Озвучуємо повідомлення українською.");publish();
        }catch(IllegalStateException e){failCurrent("Не вдалося відновити звук. Наступні повідомлення продовжать читатися.");}
    }
    private void synthesizeSegment(){
        try{
            currentId=UUID.randomUUID().toString();audioFile=File.createTempFile("voice-reader-",".wav",getCacheDir());synthesizing=true;holdCpu();
            tts.setSpeechRate(currentSpeech.rate);tts.setPitch(currentSpeech.pitch);
            int accepted=tts.synthesizeToFile(currentSpeech.plan.get(currentSpeech.segment).text,new Bundle(),audioFile,currentId);
            if(accepted==TextToSpeech.ERROR)failCurrent("Не вдалося підготувати голос. Перевірте український синтезатор мовлення.");
        }catch(IOException|IllegalStateException e){failCurrent("Не вдалося підготувати тимчасовий звук.");}
    }
    protected MediaPlayer createPlayer(){return new MediaPlayer();}
    private void prepareAudio(String id){
        if(destroyed||!id.equals(currentId)||!synthesizing)return;
        synthesizing=false;
        try{
            MediaPlayer prepared=createPlayer();player=prepared;prepared.setAudioAttributes(attributes);prepared.setDataSource(audioFile.getAbsolutePath());
            prepared.setOnPreparedListener(mp->{if(destroyed||player!=mp||!id.equals(currentId))return;playerReady=true;deleteAudioFile();if(gate.paused())releaseCpu();else drain();publish();});
            prepared.setOnCompletionListener(mp->{if(player==mp&&id.equals(currentId))segmentCompleted();});
            prepared.setOnErrorListener((mp,what,extra)->{if(player==mp&&id.equals(currentId))failCurrent("Помилка відтворення. Наступні повідомлення продовжать читатися.");return true;});
            prepared.prepareAsync();
        }catch(IOException|IllegalStateException e){failCurrent("Не вдалося відкрити підготовлений звук.");}
    }
    private void segmentCompleted(){
        speaking=false;releasePlayer();releaseCpu();currentSpeech.segment++;
        if(currentSpeech.segment>=currentSpeech.plan.size())finishCurrent();else drain();
    }
    private void deleteAudioFile(){if(audioFile!=null){audioFile.delete();audioFile=null;}}
    private void releasePlayer(){if(player!=null){player.setOnPreparedListener(null);player.setOnCompletionListener(null);player.setOnErrorListener(null);player.release();player=null;}playerReady=false;}
    private void holdCpu(){if(wake!=null&&!wake.isHeld())wake.acquire(10*60*1000L);main.removeCallbacks(watchdog);main.postDelayed(watchdog,10*60*1000L);}
    private void releaseCpu(){main.removeCallbacks(watchdog);if(wake!=null&&wake.isHeld())wake.release();}
    private void failCurrent(String reason){new Config(this).error(reason);currentId="";if(tts!=null)tts.stop();finishCurrent();}
    private void finishCurrent(){
        currentId="";speaking=false;synthesizing=false;currentSpeech=null;releasePlayer();deleteAudioFile();releaseCpu();abandonFocus();cancelFocusRetry();if(gate.waitingFocus())gate.resume();publish();main.post(this::drain);
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
    private final Runnable watchdog=()->{if(currentSpeech!=null)failCurrent("Підготовка або озвучення перевищили ліміт часу. Переходимо до наступного повідомлення.");};
    private void pause(){cancelFocusRetry();gate.pause();pausePlayback(true);new Config(this).error("Ручна пауза. Натисніть ▶, щоб продовжити.");}
    private void pausePlayback(boolean abandon){
        if(speaking&&player!=null&&playerReady){try{player.pause();}catch(IllegalStateException ignored){/* completion may already be pending */}speaking=false;}
        if(!synthesizing)releaseCpu();
        if(abandon)abandonFocus();publish();
    }
    private void publish() {
        if(session!=null)session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_STOP).setState(gate.waitingFocus()?PlaybackState.STATE_BUFFERING:gate.paused()?PlaybackState.STATE_PAUSED:speaking?PlaybackState.STATE_PLAYING:PlaybackState.STATE_STOPPED,0,1).build());
        getSystemService(NotificationManager.class).notify(1,notification());
    }
    private Notification notification() {
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,VoiceService.class).setAction(STOP),PendingIntent.FLAG_IMMUTABLE);
        PendingIntent pause=PendingIntent.getService(this,2,new Intent(this,VoiceService.class).setAction(PAUSE),PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("Voice Reader").setContentText(gate.waitingFocus()?"Очікуємо звільнення звуку • продовжимо автоматично":gate.paused()?"Читання призупинено":speaking?currentTitle:"Читання ввімкнено • екран можна вимкнути").setContentIntent(open).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE).addAction(new Notification.Action.Builder(null,gate.paused()&&!gate.waitingFocus()?"Продовжити":"Пауза",pause).build()).addAction(new Notification.Action.Builder(null,"Зупинити",stop).build());
        if(session!=null)builder.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0,1));return builder.build();
    }
    @Override public void onDestroy(){destroyed=true;running=false;if(new Config(this).enabled())recordServiceEvent("Службу завершено без натискання «Зупинити». Очікуємо відновлення Android.");main.removeCallbacksAndMessages(null);currentId="";if(tts!=null){tts.stop();tts.shutdown();}releasePlayer();deleteAudioFile();releaseCpu();abandonFocus();if(session!=null){session.setActive(false);session.release();}stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
