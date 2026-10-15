package ua.voicereader;

import java.util.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Bounded, hash-only history for individual messages and InboxStyle updates. */
public final class NotificationHistory {
    private final ReaderRules.Recent recent;
    private final int maxSnapshots,maxLines;
    private final LinkedHashMap<String,List<String>> snapshots=new LinkedHashMap<>(16,.75f,true);
    public NotificationHistory(int maxMessages,int maxSnapshots,int maxLines){recent=new ReaderRules.Recent(maxMessages);this.maxSnapshots=maxSnapshots;this.maxLines=maxLines;}
    public static String fingerprint(String value){
        try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));char[] out=new char[bytes.length*2];String hex="0123456789abcdef";for(int i=0;i<bytes.length;i++){out[i*2]=hex.charAt((bytes[i]&255)>>>4);out[i*2+1]=hex.charAt(bytes[i]&15);}return new String(out);}
        catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
    public String messageId(String app,String title,String text,long time,String discriminator){
        return fingerprint(app+"|"+ReaderRules.normalizeTitle(title)+"|"+text+"|"+time+"|"+discriminator);
    }
    public boolean claim(String id){return recent.add(id);}
    public void retry(String id){recent.remove(id);}
    public void restore(Collection<String> ids){recent.restore(ids);}
    public Set<String> ids(){return recent.values();}
    public void forget(String scope){snapshots.remove(fingerprint(scope));}
    /** Identify added rows in either chronological or newest-first InboxStyle lists. */
    public List<Integer> freshIndexes(String scope,List<String> lines){
        List<String> previous=snapshots.get(fingerprint(scope));Map<String,Integer> remaining=new HashMap<>();
        if(previous!=null)for(String hash:previous)remaining.put(hash,remaining.getOrDefault(hash,0)+1);
        List<Integer> fresh=new ArrayList<>();
        for(int i=0;i<lines.size();i++){String hash=fingerprint(lines.get(i));int old=remaining.getOrDefault(hash,0);if(old>0)remaining.put(hash,old-1);else fresh.add(i);}
        return fresh;
    }
    /** Commit only successfully handled lines; a failed transfer remains retryable. */
    public void remember(String scope,List<String> lines,int through){
        if(through<=0)return;
        List<String> hashes=hashes(lines,Math.min(through,lines.size()));
        if(hashes.size()>maxLines)hashes=new ArrayList<>(hashes.subList(hashes.size()-maxLines,hashes.size()));
        snapshots.put(fingerprint(scope),hashes);
        while(snapshots.size()>maxSnapshots)snapshots.remove(snapshots.keySet().iterator().next());
    }
    private static List<String> hashes(List<String> lines,int through){List<String> result=new ArrayList<>();for(int i=0;i<through;i++)result.add(fingerprint(lines.get(i)));return result;}
}
