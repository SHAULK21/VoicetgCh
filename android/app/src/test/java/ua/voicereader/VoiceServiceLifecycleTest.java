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
}
