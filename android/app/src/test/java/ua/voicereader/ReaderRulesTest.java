package ua.voicereader;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
public class ReaderRulesTest {
    @Test public void emptyAllowlistNeverReadsPrivateChat(){assertFalse(ReaderRules.accepts("Private",Set.of()));}
    @Test public void matchIsExactAndCaseInsensitive(){Set<String>s=ReaderRules.lines("Мой канал\nNews");assertTrue(ReaderRules.accepts("МОЙ КАНАЛ",s));assertFalse(ReaderRules.accepts("Мой канал — личный чат",s));}
    @Test public void channelTitleWithCommaIsNotSplit(){assertTrue(ReaderRules.accepts("News, today",ReaderRules.titles("News, today\nOther")));assertFalse(ReaderRules.accepts("News",ReaderRules.titles("News, today")));}
    @Test public void alertsRepeatThreeTimes(){List<String>m=ReaderRules.matched("СрОчНо новость",Set.of("срочно"));assertEquals("Внимание! СРОЧНО! СРОЧНО! СРОЧНО! \nСрОчНо новость",ReaderRules.spoken("СрОчНо новость",m));}
    @Test public void chunksNeverLoseLongText(){String s="длинное сообщение ".repeat(1000)+"😀";List<String>chunks=ReaderRules.chunks(s,100);assertEquals(s,String.join("",chunks));for(String c:chunks)assertTrue(c.length()<=100);}
    @Test public void duplicateUpdatesAreBounded(){ReaderRules.Recent r=new ReaderRules.Recent(2);assertTrue(r.add("1"));assertFalse(r.add("1"));r.add("2");r.add("3");assertEquals(2,r.values().size());assertTrue(r.add("1"));}
}
