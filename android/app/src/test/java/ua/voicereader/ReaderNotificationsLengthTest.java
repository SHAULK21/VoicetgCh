package ua.voicereader;

import android.app.*;
import android.content.Intent;
import android.os.UserHandle;
import android.service.notification.StatusBarNotification;
import org.junit.*;
import static org.junit.Assert.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,manifest=Config.NONE)
public class ReaderNotificationsLengthTest {
    private ServiceController<ReaderNotifications> controller;
    private ReaderNotifications reader;
    @Before public void setup(){
        controller=Robolectric.buildService(ReaderNotifications.class).create();reader=controller.get();
        new ua.voicereader.Config(reader).prefs.edit().clear().putBoolean("enabled",true).putString("titles","Новини").commit();VoiceService.running=true;
    }
    @After public void cleanup(){VoiceService.running=false;controller.destroy();}
    private void post(Notification notification){reader.onNotificationPosted(new StatusBarNotification("org.telegram.messenger","org.telegram.messenger",1,null,1000,0,notification,UserHandle.of(0),null,1000));}
    private Intent nextSpeech(){return Shadows.shadowOf((Application)reader.getApplicationContext()).getNextStartedService();}
    @Test public void messagingHistorySkipsLongPostButReadsNewShortPost(){
        Notification.MessagingStyle style=new Notification.MessagingStyle("Користувач").setConversationTitle("Новини")
            .addMessage("тривога "+"а".repeat(500),1,"Автор").addMessage("Коротка новина",2,"Автор");
        Notification notification=new Notification.Builder(reader,"telegram").setSmallIcon(android.R.drawable.ic_dialog_info).setStyle(style).build();
        post(notification);assertEquals("Коротка новина",nextSpeech().getStringExtra("text"));assertNull(nextSpeech());post(notification);assertNull(nextSpeech());
    }
    @Test public void inboxLongRowDoesNotBlockNextRowOrRepeatWhenFilterIsDisabled(){
        Notification notification=new Notification.Builder(reader,"telegram").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Новини")
            .setStyle(new Notification.InboxStyle().addLine("тривога "+"а".repeat(500)).addLine("Коротка новина")).build();
        post(notification);assertEquals("Коротка новина",nextSpeech().getStringExtra("text"));assertNull(nextSpeech());
        new ua.voicereader.Config(reader).prefs.edit().putBoolean("skip_long",false).commit();post(notification);assertNull(nextSpeech());
    }
}
