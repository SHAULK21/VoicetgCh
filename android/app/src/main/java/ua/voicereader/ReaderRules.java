package ua.voicereader;

import java.util.*;

/** Pure rules shared by notification parsing and speech queue; JVM-testable. */
public final class ReaderRules {
    public static final String DEFAULT_WORDS="увага, терміново, тривога, важливо";
    private ReaderRules() {}
    /** Count supplementary Unicode characters once; skip the whole source message. */
    public static boolean tooLong(String text,boolean enabled,int limit) {
        return enabled&&text.codePointCount(0,text.length())>limit;
    }
    public static Set<String> lines(String text) {
        Set<String> result=new LinkedHashSet<>();
        for(String value:text.split("[\\n,]")) {String s=value.trim().toLowerCase(Locale.ROOT);if(!s.isEmpty()) result.add(s);}
        return result;
    }
    public static Set<String> titles(String text) {
        Set<String> result=new LinkedHashSet<>();for(String value:text.split("\\n")){String title=normalizeTitle(value);if(!title.isEmpty())result.add(title);}return result;
    }
    public static boolean accepts(String title,Set<String> allowed) {
        return title!=null && allowed.contains(normalizeTitle(title));
    }
    public static String normalizeTitle(String title) {
        return title.replaceAll("[\\u200B\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]", "").replaceAll("[\\p{Z}\\s]+", " ").trim().toLowerCase(Locale.ROOT);
    }
    public static String selectTitle(String conversation,String title,Set<String> allowed) {
        if(accepts(conversation,allowed))return conversation;
        if(accepts(title,allowed))return title;
        return normalizeTitle(conversation).isEmpty()?title:conversation;
    }
    public static List<String> matched(String text,Set<String> words) {
        List<String> result=new ArrayList<>();String lower=text.toLowerCase(Locale.ROOT);
        for(String word:words) if(!word.isEmpty()&&lower.contains(word)) result.add(word);
        return result;
    }
    public static String spoken(String text,List<String> matched) {
        if(matched.isEmpty()) return text;
        return "Увага! "+repeatedKeywords(matched)+"\n"+text;
    }
    private static String repeatedKeywords(List<String> matched){
        StringBuilder out=new StringBuilder();for(String w:matched)for(int n=0;n<3;n++)out.append(w.toUpperCase(Locale.ROOT)).append("! ");return out.toString();
    }
    public static final class Segment {
        public final String text;public final float volume;
        Segment(String text,float volume){this.text=text;this.volume=volume;}
    }
    /** Alert prefix is loud; the original message always keeps its reading volume. */
    public static List<Segment> speechPlan(String text,List<String> matched,boolean loud,float normal,float alert,boolean night,float quiet,int max) {
        return speechPlan(text,matched,loud,false,normal,alert,night,quiet,max);
    }
    public static List<Segment> speechPlan(String text,List<String> matched,boolean loud,boolean onlyKeywords,float normal,float alert,boolean night,float quiet,int max) {
        List<Segment> result=new ArrayList<>();
        if(loud&&!matched.isEmpty())for(String part:chunks((onlyKeywords?repeatedKeywords(matched):spoken("",matched)).trim(),max))result.add(new Segment(part,Math.max(normal,alert)));
        String body=onlyKeywords?(loud?"":String.join(". ",matched)):text;
        for(String part:chunks(body,max))result.add(new Segment(part,night?Math.min(normal,quiet):normal));
        return result;
    }
    public static List<String> chunks(String text,int max) {
        List<String> result=new ArrayList<>();int start=0;
        while(start<text.length()) {
            int end=Math.min(start+max,text.length());
            if(end<text.length()) {int space=text.lastIndexOf(' ',end);if(space>start+max/2) end=space;if(Character.isHighSurrogate(text.charAt(end-1))) end--;}
            result.add(text.substring(start,end));start=end;
        }
        return result;
    }
    /** Distinguishes a user pause from a temporary interruption by Android. */
    public static final class PlaybackGate {
        private boolean paused,waitingFocus;
        public boolean paused(){return paused;}
        public boolean waitingFocus(){return waitingFocus;}
        public void pause(){paused=true;waitingFocus=false;}
        public void waitForFocus(){paused=true;waitingFocus=true;}
        public void resume(){paused=false;waitingFocus=false;}
        public boolean focusGained(){if(!waitingFocus)return false;resume();return true;}
    }
    public static final class Recent {
        private final LinkedHashSet<String> keys=new LinkedHashSet<>();private final int max;
        public Recent(int max){this.max=max;}
        public boolean add(String key){if(!keys.add(key))return false;while(keys.size()>max)keys.remove(keys.iterator().next());return true;}
        public void remove(String key){keys.remove(key);}
        public void restore(Collection<String> values){for(String value:values)add(value);}
        public Set<String> values(){return new LinkedHashSet<>(keys);}
    }
}
