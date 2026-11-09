package ua.voicereader;

import android.app.*;
import android.content.Intent;
import android.service.notification.StatusBarNotification;
import org.junit.*;
import static org.junit.Assert.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,manifest=Config.NONE)
public class ReaderNotificationsRepeatTest {
    private ServiceController<ReaderNotifications> controller;private ReaderNotifications reader;
    @Before public void setup(){
        controller=Robolectric.buildService(ReaderNotifications.class).create();reader=controller.get();
        new ua.voicereader.Config(reader).prefs.edit().clear().putBoolean("enabled",true).putString("titles","Новини").commit();VoiceService.running=true;
    }
    @After public void cleanup(){VoiceService.running=false;controller.destroy();}
    private Notification.Builder builder(long when){return new Notification.Builder(reader,"telegram").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Новини").setWhen(when);}
    private Notification plain(String text,long when){return builder(when).setContentText(text).build();}
    private StatusBarNotification wrapped(Notification notification,long posted){return new StatusBarNotification("org.telegram.messenger","org.telegram.messenger",1,null,1000,0,0,notification,android.os.Process.myUserHandle(),posted);}
    private void post(Notification notification,long posted){reader.onNotificationPosted(wrapped(notification,posted));}
    private Intent nextSpeech(){return Shadows.shadowOf((Application)reader.getApplicationContext()).getNextStartedService();}
    private void assertSpeech(String expected){Intent speech=nextSpeech();assertNotNull(speech);assertEquals(expected,speech.getStringExtra("text"));assertNull(nextSpeech());}
    private Notification messaging(String[] texts,long[] times){
        Notification.MessagingStyle style=new Notification.MessagingStyle("Користувач").setConversationTitle("Новини");
        for(int i=0;i<texts.length;i++)style.addMessage(texts[i],times[i],"Автор");return builder(1000).setStyle(style).build();
    }
    @Test public void ordinaryTextRepostedThreeTimesWithNewTimestampsIsSpokenOnce(){
        post(plain("Звичайна новина",1000),1000);assertSpeech("Звичайна новина");
        post(plain("Звичайна новина",2000),2000);post(plain("Звичайна новина",3000),3000);assertNull(nextSpeech());
    }
    @Test public void missingSourceTimestampDoesNotUseRepostTimeAsNewMessage(){
        post(plain("Звичайна новина",0),1000);assertSpeech("Звичайна новина");post(plain("Звичайна новина",0),2000);assertNull(nextSpeech());
    }
    @Test public void aCopyUnderAnotherNotificationKeyDoesNotReadTheBodyTwice(){
        post(plain("Звичайна новина",100),1000);assertSpeech("Звичайна новина");
        reader.onNotificationPosted(new StatusBarNotification("org.telegram.messenger","org.telegram.messenger",2,null,1000,0,0,plain("Звичайна новина",200),android.os.Process.myUserHandle(),2000));assertNull(nextSpeech());
    }
    @Test public void styleChangesDoNotReadTheSameMessageAgain(){
        post(plain("Перша новина",100),1000);assertSpeech("Перша новина");
        post(builder(200).setStyle(new Notification.InboxStyle().addLine("Перша новина")).build(),2000);assertNull(nextSpeech());
        post(messaging(new String[]{"Перша новина"},new long[]{300}),3000);assertNull(nextSpeech());
        post(messaging(new String[]{"Перша новина","Друга новина"},new long[]{300,400}),4000);assertSpeech("Друга новина");
    }
    @Test public void separateStructuredMessagesWithEqualTextAreStillNewMessages(){
        post(messaging(new String[]{"Тривога"},new long[]{100}),1000);assertSpeech("Тривога");
        post(messaging(new String[]{"Тривога","Тривога"},new long[]{100,200}),2000);assertSpeech("Тривога");
        post(messaging(new String[]{"Тривога","Тривога"},new long[]{100,200}),3000);assertNull(nextSpeech());
    }
    @Test public void changedPlainBodyIsReadWhileOldNotificationStaysVisible(){
        post(plain("Перша новина",100),1000);assertSpeech("Перша новина");post(plain("Друга новина",200),2000);assertSpeech("Друга новина");
    }
    @Test public void dismissalAllowsASeparatePlainDeliveryWithTheSameText(){
        Notification notification=plain("Звичайна новина",100);post(notification,1000);assertSpeech("Звичайна новина");
        reader.onNotificationRemoved(wrapped(notification,1000));post(plain("Звичайна новина",200),2000);assertSpeech("Звичайна новина");
    }
    @Test public void baselinePlainNotificationIsNotReadWhenItsTimestampChanges(){
        org.robolectric.util.ReflectionHelpers.callInstanceMethod(reader,"process",org.robolectric.util.ReflectionHelpers.ClassParameter.from(StatusBarNotification.class,wrapped(plain("Стара новина",100),1000)),org.robolectric.util.ReflectionHelpers.ClassParameter.from(boolean.class,true));
        post(plain("Стара новина",200),2000);assertNull(nextSpeech());post(plain("Нова новина",300),3000);assertSpeech("Нова новина");
    }
}
