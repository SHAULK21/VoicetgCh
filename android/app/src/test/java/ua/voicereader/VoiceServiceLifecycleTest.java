package ua.voicereader;

import android.app.Service;
import android.content.Intent;
import org.junit.*;
import static org.junit.Assert.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,manifest=Config.NONE)
public class VoiceServiceLifecycleTest {
    /** Exercise the real start/destroy contract without invoking an external TTS engine. */
    public static class LifecycleService extends VoiceService { @Override public void onCreate(){} }
    private ServiceController<LifecycleService> controller;
    private LifecycleService service;private boolean destroyed;
    @Before public void setup(){controller=Robolectric.buildService(LifecycleService.class).create();service=controller.get();new ua.voicereader.Config(service).prefs.edit().clear().putBoolean("enabled",true).commit();}
    @After public void cleanup(){if(!destroyed)controller.destroy();}
    @Test public void systemRestartWithNullIntentKeepsEnabledReaderRunning(){
        assertEquals(Service.START_STICKY,service.onStartCommand(null,0,1));assertTrue(new ua.voicereader.Config(service).enabled());
    }
    @Test public void systemRestartDoesNotReactivateExplicitlyStoppedReader(){
        new ua.voicereader.Config(service).prefs.edit().putBoolean("enabled",false).commit();assertEquals(Service.START_NOT_STICKY,service.onStartCommand(null,0,1));assertFalse(new ua.voicereader.Config(service).enabled());
    }
    @Test public void unexpectedDestructionPreservesUserChoice(){
        controller.destroy();destroyed=true;assertTrue(new ua.voicereader.Config(service).enabled());assertTrue(new ua.voicereader.Config(service).prefs.getString("service_event","").contains("без натискання"));
    }
    @Test public void stopActionDisablesStickyRecovery(){
        assertEquals(Service.START_NOT_STICKY,service.onStartCommand(new Intent().setAction(VoiceService.STOP),0,1));assertFalse(new ua.voicereader.Config(service).enabled());assertEquals(Service.START_NOT_STICKY,service.onStartCommand(null,0,2));
    }
    private java.util.Deque<?> queued(){return org.robolectric.util.ReflectionHelpers.getField(service,"queue");}
    private void receive(String text){service.onStartCommand(new Intent().setAction(VoiceService.SPEAK).putExtra("title","Новини").putExtra("text",text),0,2);}
    @Test public void longKeywordMessageNeverEntersFullReadingQueue(){
        receive("тривога "+"а".repeat(500));assertTrue(queued().isEmpty());assertTrue(new ua.voicereader.Config(service).prefs.getString("status","").contains("Довге повідомлення"));
    }
    @Test public void keywordsOnlyCannotBypassLengthFilter(){
        new ua.voicereader.Config(service).prefs.edit().putBoolean("only_keywords",true).commit();receive("тривога "+"а".repeat(500));assertTrue(queued().isEmpty());
        receive("тривога коротке повідомлення");assertEquals(1,queued().size());
    }
    @Test public void disablingLengthFilterAcceptsLongMessage(){
        new ua.voicereader.Config(service).prefs.edit().putBoolean("skip_long",false).commit();receive("а".repeat(501));assertEquals(1,queued().size());
    }
    @Test public void pendingMessageIsRecheckedAfterChangingLimit(){
        ua.voicereader.Config config=new ua.voicereader.Config(service);config.prefs.edit().putInt("max_message_length",1000).commit();receive("а".repeat(501));assertEquals(1,queued().size());
        config.prefs.edit().putInt("max_message_length",500).commit();org.robolectric.util.ReflectionHelpers.setField(service,"ready",true);org.robolectric.util.ReflectionHelpers.callInstanceMethod(service,"drain");assertTrue(queued().isEmpty());
    }
    @Test public void voiceTestsBypassLengthLimit(){
        new ua.voicereader.Config(service).prefs.edit().putInt("max_message_length",100).putString("words","ф".repeat(120)).commit();
        service.onStartCommand(new Intent().setAction(VoiceService.TEST),0,2);service.onStartCommand(new Intent().setAction(VoiceService.TEST_NORMAL),0,3);assertEquals(2,queued().size());
    }
}
