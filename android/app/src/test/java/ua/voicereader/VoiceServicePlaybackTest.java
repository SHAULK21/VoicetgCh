package ua.voicereader;

import android.content.*;
import android.media.*;
import android.os.*;
import android.speech.tts.TextToSpeech;
import java.io.File;
import java.time.Duration;
import java.util.*;
import org.junit.*;
import static org.junit.Assert.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;
import static org.robolectric.util.ReflectionHelpers.ClassParameter.from;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,manifest=Config.NONE)
public class VoiceServicePlaybackTest {
    public static class TestService extends VoiceService {
        FakePlayer last;final List<FakePlayer> players=new ArrayList<>();
        @Override public void onCreate(){}
        @Override protected MediaPlayer createPlayer(){last=new FakePlayer();players.add(last);return last;}
    }
    /** Models a seekable player: starting after pause keeps its current millisecond position. */
    static class FakePlayer extends MediaPlayer {
        int position;boolean released;float volume;final List<Integer> starts=new ArrayList<>();
        OnPreparedListener prepared;OnCompletionListener completed;OnErrorListener error;
        @Override public void setAudioAttributes(AudioAttributes attributes){}
        @Override public void setDataSource(String path){}
        @Override public void setOnPreparedListener(OnPreparedListener listener){prepared=listener;}
        @Override public void setOnCompletionListener(OnCompletionListener listener){completed=listener;}
        @Override public void setOnErrorListener(OnErrorListener listener){error=listener;}
        @Override public void prepareAsync(){prepared.onPrepared(this);}
        @Override public void start(){starts.add(position);}
        @Override public void pause(){}
        @Override public int getCurrentPosition(){return position;}
        @Override public void setVolume(float left,float right){volume=left;}
        @Override public void release(){released=true;}
    }
    static class FakeTts extends TextToSpeech {
        final List<String> texts=new ArrayList<>();String id;File output;
        FakeTts(Context context){super(context,status->{});}
        @Override public int setSpeechRate(float rate){return SUCCESS;}
        @Override public int setPitch(float pitch){return SUCCESS;}
        @Override public int synthesizeToFile(CharSequence text,Bundle params,File file,String utteranceId){texts.add(text.toString());id=utteranceId;output=file;return SUCCESS;}
        @Override public int stop(){return SUCCESS;}
        @Override public void shutdown(){}
    }
    private ServiceController<TestService> controller;private TestService service;private FakeTts tts;private AudioManager audio;private PowerManager.WakeLock wake;
    @Before public void setup(){
        controller=Robolectric.buildService(TestService.class).create();service=controller.get();
        new ua.voicereader.Config(service).prefs.edit().clear().putBoolean("enabled",true).commit();
        ReflectionHelpers.callInstanceMethod(service,"configureAudio");audio=service.getSystemService(AudioManager.class);
        Shadows.shadowOf(audio).setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        tts=new FakeTts(service);ReflectionHelpers.setField(service,"tts",tts);ReflectionHelpers.setField(service,"ready",true);
        wake=service.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"ReaderTest");wake.setReferenceCounted(false);ReflectionHelpers.setField(service,"wake",wake);
    }
    @After public void cleanup(){controller.destroy();}
    private void receive(String text){service.onStartCommand(new Intent().setAction(VoiceService.SPEAK).putExtra("title","Новини").putExtra("text",text),0,1);}
    private void prepared(){ReflectionHelpers.callInstanceMethod(service,"prepareAudio",from(String.class,tts.id));}
    private void focus(int change){ReflectionHelpers.callInstanceMethod(service,"audioFocusChanged",from(int.class,change));}
    private ReaderRules.PlaybackGate gate(){return ReflectionHelpers.getField(service,"gate");}
    private void advance(int seconds){Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(seconds));}
    @Test public void notificationSoundResumesAtSameAudioPositionWithoutResynthesizingBody(){
        receive("Звичайне повідомлення");File temporary=tts.output;prepared();FakePlayer player=service.last;assertFalse(temporary.exists());player.position=850;
        focus(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK);assertTrue(gate().waitingFocus());assertFalse(wake.isHeld());
        focus(AudioManager.AUDIOFOCUS_GAIN);assertSame(player,service.last);assertEquals(Arrays.asList(0,850),player.starts);assertEquals(1,tts.texts.size());
        player.completed.onCompletion(player);advance(0);assertNull(ReflectionHelpers.getField(service,"currentSpeech"));assertEquals(1,tts.texts.size());assertFalse(wake.isHeld());
    }
    @Test public void permanentFocusLossRetriesAutomaticallyWithoutPressingPlay(){
        receive("Звичайне повідомлення");prepared();FakePlayer player=service.last;player.position=1200;
        focus(AudioManager.AUDIOFOCUS_LOSS);assertTrue(gate().waitingFocus());advance(2);
        assertFalse(gate().paused());assertEquals(Arrays.asList(0,1200),player.starts);assertEquals(1,tts.texts.size());
    }
    @Test public void deniedFocusWaitsWithoutCpuLockAndRetriesWithBackoff(){
        Shadows.shadowOf(audio).setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_FAILED);receive("Звичайне повідомлення");prepared();
        assertTrue(gate().waitingFocus());assertFalse(wake.isHeld());assertTrue(service.last.starts.isEmpty());advance(2);assertTrue(gate().waitingFocus());
        Shadows.shadowOf(audio).setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_GRANTED);advance(4);
        assertFalse(gate().paused());assertEquals(List.of(0),service.last.starts);assertEquals(1,tts.texts.size());
    }
    @Test public void manualPauseCancelsAutomaticRetriesAndIgnoresLateGain(){
        Shadows.shadowOf(audio).setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_FAILED);receive("Звичайне повідомлення");prepared();
        service.onStartCommand(new Intent().setAction(VoiceService.PAUSE),0,2);Shadows.shadowOf(audio).setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        focus(AudioManager.AUDIOFOCUS_GAIN);advance(60);assertTrue(gate().paused());assertFalse(gate().waitingFocus());assertTrue(service.last.starts.isEmpty());
        service.onStartCommand(new Intent().setAction("START"),0,3);assertEquals(List.of(0),service.last.starts);
    }
    @Test public void delayedGainStartsPreparedAudioOnlyOnce(){
        Shadows.shadowOf(audio).setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_DELAYED);receive("Звичайне повідомлення");prepared();assertTrue(gate().waitingFocus());
        focus(AudioManager.AUDIOFOCUS_GAIN);focus(AudioManager.AUDIOFOCUS_GAIN);advance(30);assertEquals(List.of(0),service.last.starts);assertEquals(1,tts.texts.size());
    }
    @Test public void completedAlertIsNotRepeatedWhenTheOrdinaryBodyIsInterrupted(){
        receive("Тривога: перейдіть до укриття.");prepared();FakePlayer alert=service.last;assertTrue(tts.texts.get(0).contains("ТРИВОГА! ТРИВОГА! ТРИВОГА!"));alert.completed.onCompletion(alert);
        prepared();FakePlayer body=service.last;body.position=700;focus(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);focus(AudioManager.AUDIOFOCUS_GAIN);
        assertEquals(List.of("Увага! ТРИВОГА! ТРИВОГА! ТРИВОГА!","Тривога: перейдіть до укриття."),tts.texts);assertEquals(Arrays.asList(0,700),body.starts);
    }
    @Test public void newMessageWaitsBehindPausedCurrentAudioAndIsReadOnceAfterIt(){
        receive("Перша новина");prepared();FakePlayer first=service.last;first.position=500;focus(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);receive("Друга новина");
        focus(AudioManager.AUDIOFOCUS_GAIN);first.completed.onCompletion(first);advance(0);prepared();assertEquals(List.of("Перша новина","Друга новина"),tts.texts);assertEquals(List.of(0),service.last.starts);
    }
    @Test public void duplicateDeliveryIntentDoesNotSynthesizeAnotherCopy(){
        Intent delivery=new Intent().setAction(VoiceService.SPEAK).putExtra("title","Новини").putExtra("text","Звичайна новина").putExtra("delivery_id","same");
        service.onStartCommand(delivery,0,1);prepared();service.last.completed.onCompletion(service.last);advance(0);service.onStartCommand(delivery,0,2);assertEquals(1,tts.texts.size());
    }
    @Test public void pauseDuringSynthesisPreparesAudioButDoesNotStartIt(){
        receive("Звичайна новина");service.onStartCommand(new Intent().setAction(VoiceService.PAUSE),0,2);prepared();assertTrue(service.last.starts.isEmpty());assertFalse(wake.isHeld());
        service.onStartCommand(new Intent().setAction("START"),0,3);assertEquals(List.of(0),service.last.starts);assertEquals(1,tts.texts.size());
    }
}
