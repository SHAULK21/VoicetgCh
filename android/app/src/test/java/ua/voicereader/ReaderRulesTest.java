package ua.voicereader;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
public class ReaderRulesTest {
    @Test public void emptyAllowlistNeverReadsPrivateChat(){assertFalse(ReaderRules.accepts("Private",Set.of()));}
    @Test public void matchIsExactAndCaseInsensitive(){Set<String>s=ReaderRules.lines("Мой канал\nNews");assertTrue(ReaderRules.accepts("МОЙ КАНАЛ",s));assertFalse(ReaderRules.accepts("Мой канал — личный чат",s));}
    @Test public void channelTitleWithCommaIsNotSplit(){assertTrue(ReaderRules.accepts("News, today",ReaderRules.titles("News, today\nOther")));assertFalse(ReaderRules.accepts("News",ReaderRules.titles("News, today")));}
    @Test public void notificationTitleIgnoresInvisibleDirectionMarkersAndUnicodeSpaces(){
        assertTrue(ReaderRules.accepts("\u200fКиїв\u00a0  Новини\u200e",ReaderRules.titles("Київ Новини")));
        assertFalse(ReaderRules.accepts("Київ Новини приватний чат",ReaderRules.titles("Київ Новини")));
    }
    @Test public void telegramRawTitleCanMatchWhenConversationTitleDiffers(){
        Set<String> allowed=ReaderRules.titles("Київ Новини");
        assertEquals("Київ Новини",ReaderRules.selectTitle("Інший заголовок","Київ Новини",allowed));
        assertEquals("Київ Новини",ReaderRules.selectTitle("Київ Новини","Автор",allowed));
    }
    @Test public void noConversationTitleFallsBackToNotificationTitle(){
        assertEquals("Новини",ReaderRules.selectTitle("\u200e", "Новини",Set.of()));
        assertFalse(ReaderRules.accepts(ReaderRules.selectTitle("Чужий канал","Інший чат",ReaderRules.titles("Мій канал")),ReaderRules.titles("Мій канал")));
    }
    @Test public void failedDeliveryCanBeRetriedWithoutDuplicateSuppression(){
        ReaderRules.Recent recent=new ReaderRules.Recent(200);assertTrue(recent.add("delivery"));recent.remove("delivery");assertTrue(recent.add("delivery"));assertFalse(recent.add("delivery"));
    }
    @Test public void temporaryAudioInterruptionResumesOnFocusGain(){
        ReaderRules.PlaybackGate gate=new ReaderRules.PlaybackGate();gate.waitForFocus();assertTrue(gate.paused());assertTrue(gate.focusGained());assertFalse(gate.paused());
    }
    @Test public void focusGainDoesNotOverrideUserPause(){
        ReaderRules.PlaybackGate gate=new ReaderRules.PlaybackGate();gate.pause();assertFalse(gate.focusGained());assertTrue(gate.paused());
        gate.resume();assertFalse(gate.paused());
    }
    @Test public void userPauseDuringTemporaryInterruptionCancelsAutomaticResume(){
        ReaderRules.PlaybackGate gate=new ReaderRules.PlaybackGate();gate.waitForFocus();gate.pause();assertFalse(gate.focusGained());assertTrue(gate.paused());
    }
    @Test public void alertsRepeatThreeTimes(){List<String>m=ReaderRules.matched("СрОчНо новость",Set.of("срочно"));assertEquals("Увага! СРОЧНО! СРОЧНО! СРОЧНО! \nСрОчНо новость",ReaderRules.spoken("СрОчНо новость",m));}
    @Test public void ukrainianAlertsAreLoudButBodyKeepsNormalVolume(){
        String text="ТЕРМІНОВО: важливо прочитати";
        List<ReaderRules.Segment> plan=ReaderRules.speechPlan(text,ReaderRules.matched(text,ReaderRules.lines("терміново, важливо")),true,.6f,1f,false,.28f,3000);
        assertEquals(2,plan.size());assertEquals("Увага! ТЕРМІНОВО! ТЕРМІНОВО! ТЕРМІНОВО! ВАЖЛИВО! ВАЖЛИВО! ВАЖЛИВО!",plan.get(0).text);
        assertEquals(1f,plan.get(0).volume,0f);assertEquals(.6f,plan.get(1).volume,0f);assertEquals(text,plan.get(1).text);
    }
    @Test public void nightDoesNotQuietKeywordAnnouncement(){
        List<ReaderRules.Segment> plan=ReaderRules.speechPlan("Тривога",List.of("тривога"),true,.6f,1f,true,.28f,3000);
        assertEquals(1f,plan.get(0).volume,0f);assertEquals(.28f,plan.get(1).volume,0f);
    }
    @Test public void disabledAlertsReadOriginalOnly(){
        List<ReaderRules.Segment> plan=ReaderRules.speechPlan("Тривога",List.of("тривога"),false,.6f,1f,false,.28f,3000);
        assertEquals(1,plan.size());assertEquals("Тривога",plan.get(0).text);assertEquals(.6f,plan.get(0).volume,0f);
    }
    @Test public void splitAlertKeepsLoudVolumeAndOriginalBody(){
        String text="Новини ".repeat(100)+"😀";
        List<ReaderRules.Segment> plan=ReaderRules.speechPlan(text,List.of("дуже важливе повідомлення"),true,.6f,1f,false,.28f,25);
        StringBuilder body=new StringBuilder();for(ReaderRules.Segment part:plan){assertTrue(part.text.length()<=25);if(part.volume==.6f)body.append(part.text);}
        assertEquals(text,body.toString());assertTrue(plan.get(0).volume>.6f);
    }
    @Test public void noMatchAddsNoAnnouncement(){
        List<ReaderRules.Segment> plan=ReaderRules.speechPlan("Новини",List.of(),true,.6f,1f,false,.28f,3000);assertEquals(1,plan.size());assertEquals("Новини",plan.get(0).text);
    }
    @Test public void nightNeverRaisesReadingVolume(){
        List<ReaderRules.Segment> plan=ReaderRules.speechPlan("Новини",List.of(),true,.1f,1f,true,.28f,3000);assertEquals(.1f,plan.get(0).volume,0f);
    }
    @Test public void keywordsOnlyNeverIncludesOriginalMessage(){
        String text="Тривога: сторонній текст, який не має звучати";
        List<ReaderRules.Segment> plan=ReaderRules.speechPlan(text,List.of("тривога"),true,true,.6f,1f,false,.28f,3000);
        assertEquals(1,plan.size());assertEquals("ТРИВОГА! ТРИВОГА! ТРИВОГА!",plan.get(0).text);assertEquals(1f,plan.get(0).volume,0f);
    }
    @Test public void keywordsOnlyWithoutMatchesIsSilent(){
        assertTrue(ReaderRules.speechPlan("Звичайна новина",List.of(),true,true,.6f,1f,false,.28f,3000).isEmpty());
        assertTrue(ReaderRules.speechPlan("Звичайна новина",List.of(),false,true,.6f,1f,false,.28f,3000).isEmpty());
    }
    @Test public void keywordsOnlyWithoutLoudAccentReadsPhrasesOnce(){
        List<ReaderRules.Segment> plan=ReaderRules.speechPlan("Не читати весь цей текст",List.of("повітряна тривога","відбій"),false,true,.6f,1f,false,.28f,3000);
        assertEquals(1,plan.size());assertEquals("повітряна тривога. відбій",plan.get(0).text);assertEquals(.6f,plan.get(0).volume,0f);
    }
    @Test public void quietKeywordsOnlyRespectsNightVolume(){
        List<ReaderRules.Segment> plan=ReaderRules.speechPlan("Тривога",List.of("тривога"),false,true,.6f,1f,true,.28f,3000);assertEquals(.28f,plan.get(0).volume,0f);
    }
    @Test public void keywordsOnlyStillFindsSeveralUserPhrases(){
        String text="ПОВІТРЯНА ТРИВОГА, потім відбій";
        List<String> words=ReaderRules.matched(text,ReaderRules.lines("повітряна тривога, відбій"));assertEquals(2,words.size());
        String spoken=ReaderRules.speechPlan(text,words,false,true,.6f,1f,false,.28f,3000).get(0).text;assertEquals("повітряна тривога. відбій",spoken);
    }
    @Test public void chunksNeverLoseLongText(){String s="длинное сообщение ".repeat(1000)+"😀";List<String>chunks=ReaderRules.chunks(s,100);assertEquals(s,String.join("",chunks));for(String c:chunks)assertTrue(c.length()<=100);}
    @Test public void duplicateUpdatesAreBounded(){ReaderRules.Recent r=new ReaderRules.Recent(2);assertTrue(r.add("1"));assertFalse(r.add("1"));r.add("2");r.add("3");assertEquals(2,r.values().size());assertTrue(r.add("1"));}
}
