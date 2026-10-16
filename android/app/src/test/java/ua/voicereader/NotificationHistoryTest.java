package ua.voicereader;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;

public class NotificationHistoryTest {
    @Test public void mirroredPlainNotificationWithAnotherKeyIsSuppressedBriefly(){
        NotificationHistory h=tracker();h.delivered("telegram","Новини","Звичайний текст","key1",100,false,1000);
        assertTrue(h.isMirror("telegram","Новини","Звичайний  текст","key2",200,false,1100));
        assertFalse(h.isMirror("telegram","Новини","Звичайний текст","key2",300,false,6001));
        assertFalse(h.isMirror("telegram","Інший канал","Звичайний текст","key2",200,false,1100));
    }
    @Test public void separateStructuredMessagesWithDistinctTimesAreNotMirrors(){
        NotificationHistory h=tracker();h.delivered("telegram","Новини","Тривога","key1",100,true,1000);
        assertFalse(h.isMirror("telegram","Новини","Тривога","key2",200,true,1100));assertTrue(h.isMirror("telegram","Новини","Тривога","key2",100,true,1100));
    }
    @Test public void dismissalClearsMirrorGuardForNewDelivery(){
        NotificationHistory h=tracker();h.delivered("telegram","Новини","Текст","key1",100,false,1000);h.forget("key1");assertFalse(h.isMirror("telegram","Новини","Текст","key2",200,false,1100));
    }
    private NotificationHistory tracker(){return new NotificationHistory(200,40,100);}
    private String id(NotificationHistory h,String text,long time){return h.messageId("org.telegram.messenger","Новини",text,time,"");}
    @Test public void unswipedMessagingNotificationReadsOnlyNewMessage(){
        NotificationHistory h=tracker();assertTrue(h.claim(id(h,"Перше повідомлення",1000)));
        assertFalse(h.claim(id(h,"Перше повідомлення",1000)));assertTrue(h.claim(id(h,"Друге повідомлення",2000)));
        assertFalse(h.claim(id(h,"Перше повідомлення",1000)));assertFalse(h.claim(id(h,"Друге повідомлення",2000)));
    }
    @Test public void equalPhrasesInSeparateNewMessagesAreBothRead(){
        NotificationHistory h=tracker();assertTrue(h.claim(id(h,"Тривога",1000)));assertTrue(h.claim(id(h,"Тривога",2000)));
    }
    @Test public void equalTextAndTimestampCanHaveSeparateOccurrencesInOneBundle(){
        NotificationHistory h=tracker();assertTrue(h.claim(id(h,"Тривога",1000)));
        String second=h.messageId("org.telegram.messenger","Новини","Тривога",1000,"occurrence:1");assertTrue(h.claim(second));assertFalse(h.claim(second));
    }
    @Test public void sourceAndChannelKeepIndependentMessages(){
        NotificationHistory h=tracker();String first=id(h,"Тривога",1000);assertTrue(h.claim(first));
        assertTrue(h.claim(h.messageId("org.telegram.messenger","Інший канал","Тривога",1000,"")));
        assertTrue(h.claim(h.messageId("org.thunderdog.challegram","Новини","Тривога",1000,"")));
    }
    @Test public void inboxUpdateDoesNotRepeatUnswipedLines(){
        NotificationHistory h=tracker();h.remember("same notification",List.of("A"),1);
        List<String> updated=List.of("A","B");assertEquals(List.of(1),h.freshIndexes("same notification",updated));h.remember("same notification",updated,updated.size());
        assertTrue(h.freshIndexes("same notification",updated).isEmpty());
    }
    @Test public void rollingInboxWindowReadsOnlyNewTail(){
        NotificationHistory h=tracker();h.remember("same",List.of("A","B"),2);List<String> next=List.of("B","C");assertEquals(List.of(1),h.freshIndexes("same",next));
    }
    @Test public void newestFirstInboxDoesNotRepeatOldTail(){
        NotificationHistory h=tracker();h.remember("same",List.of("B","A"),2);assertEquals(List.of(0),h.freshIndexes("same",List.of("C","B","A")));
    }
    @Test public void reorderedInboxWithoutNewRowsIsSilent(){
        NotificationHistory h=tracker();h.remember("same",List.of("A","B"),2);assertTrue(h.freshIndexes("same",List.of("B","A")).isEmpty());
    }
    @Test public void repeatedInboxPhraseIsNewWhenAppendedAsAnotherLine(){
        NotificationHistory h=tracker();h.remember("same",List.of("Тривога"),1);assertEquals(List.of(1),h.freshIndexes("same",List.of("Тривога","Тривога")));
    }
    @Test public void separateNotificationSnapshotsDoNotSuppressEachOther(){
        NotificationHistory h=tracker();h.remember("channel one",List.of("A"),1);assertEquals(List.of(0),h.freshIndexes("channel two",List.of("A")));
    }
    @Test public void failedInboxTransferCommitsOnlySuccessfulPrefix(){
        NotificationHistory h=tracker();List<String> lines=List.of("A","B","C");h.remember("same",lines,2);assertEquals(List.of(2),h.freshIndexes("same",lines));
    }
    @Test public void baselineAndPersistedIdsPreventReplayAfterRestart(){
        NotificationHistory h=tracker();h.claim(id(h,"A",1000));NotificationHistory restored=tracker();restored.restore(h.ids());assertFalse(restored.claim(id(restored,"A",1000)));assertTrue(restored.claim(id(restored,"B",2000)));
        restored.remember("active",List.of("A","B"),2);assertEquals(List.of(2),restored.freshIndexes("active",List.of("A","B","C")));
    }
    @Test public void failureCanBeRetried(){NotificationHistory h=tracker();String id=id(h,"A",1000);assertTrue(h.claim(id));h.retry(id);assertTrue(h.claim(id));}
    @Test public void identicalInboxAfterDismissalIsANewNotification(){
        NotificationHistory h=tracker();h.remember("same key",List.of("Тривога"),1);h.forget("same key");assertEquals(List.of(0),h.freshIndexes("same key",List.of("Тривога")));
    }
}
