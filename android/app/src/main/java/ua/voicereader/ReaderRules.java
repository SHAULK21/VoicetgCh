package ua.voicereader;

import java.util.*;

/** Pure rules shared by notification parsing and speech queue; JVM-testable. */
public final class ReaderRules {
    private ReaderRules() {}
    public static Set<String> lines(String text) {
        Set<String> result=new LinkedHashSet<>();
        for(String value:text.split("[\\n,]")) {String s=value.trim().toLowerCase(Locale.ROOT);if(!s.isEmpty()) result.add(s);}
        return result;
    }
    public static Set<String> titles(String text) {
        Set<String> result=new LinkedHashSet<>();for(String value:text.split("\\n")){String title=value.trim().toLowerCase(Locale.ROOT);if(!title.isEmpty())result.add(title);}return result;
    }
    public static boolean accepts(String title,Set<String> allowed) {
        return title!=null && allowed.contains(title.trim().toLowerCase(Locale.ROOT));
    }
    public static List<String> matched(String text,Set<String> words) {
        List<String> result=new ArrayList<>();String lower=text.toLowerCase(Locale.ROOT);
        for(String word:words) if(!word.isEmpty()&&lower.contains(word)) result.add(word);
        return result;
    }
    public static String spoken(String text,List<String> matched) {
        if(matched.isEmpty()) return text;
        StringBuilder out=new StringBuilder("Внимание! ");
        for(String w:matched) for(int n=0;n<3;n++) out.append(w.toUpperCase(Locale.ROOT)).append("! ");
        return out.append("\n").append(text).toString();
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
    public static final class Recent {
        private final LinkedHashSet<String> keys=new LinkedHashSet<>();private final int max;
        public Recent(int max){this.max=max;}
        public boolean add(String key){if(!keys.add(key))return false;while(keys.size()>max)keys.remove(keys.iterator().next());return true;}
        public void restore(Collection<String> values){for(String value:values)add(value);}
        public Set<String> values(){return new LinkedHashSet<>(keys);}
    }
}
