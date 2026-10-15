package ua.voicereader;

import android.app.Notification;
import android.content.Intent;
import android.os.*;
import android.service.notification.*;
import java.util.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

public final class ReaderNotifications extends NotificationListenerService {
    private static final Set<String> PACKAGES=new HashSet<>(Arrays.asList("org.telegram.messenger","org.telegram.messenger.web","org.telegram.messenger.beta","org.thunderdog.challegram"));
    private final ReaderRules.Recent recent=new ReaderRules.Recent(200);
    @Override public void onListenerConnected(){recent.restore(new Config(this).prefs.getStringSet("seen",Collections.emptySet()));new Config(this).error("Доступ к уведомлениям подключён");}
    @Override public void onListenerDisconnected(){new Config(this).error("Доступ к уведомлениям прерван. Откройте приложение и проверьте разрешение.");}
    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        Config config=new Config(this);
        if(!config.enabled()||!PACKAGES.contains(sbn.getPackageName()))return;
        Notification n=sbn.getNotification();
        if((n.flags&Notification.FLAG_GROUP_SUMMARY)!=0)return;
        String title=string(n.extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE));
        if(title.trim().isEmpty())title=string(n.extras.getCharSequence(Notification.EXTRA_TITLE));
        if(!ReaderRules.accepts(title,config.titles()))return;
        if(!VoiceService.running){config.error("Чтение остановлено системой. Нажмите «Запустить чтение».");return;}
        Parcelable[] messages=n.extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        if(messages!=null&&messages.length>0) {
            // Telegram may re-publish the whole conversation. Read only new items;
            // older bundled items preceding service start must not be replayed.
            for(Parcelable item:messages)if(item instanceof Bundle) {
                Bundle b=(Bundle)item;long time=b.getLong("time",0);
                if(time!=0&&time<VoiceService.startedAt)continue;
                emit(sbn,title,string(b.getCharSequence("text")),time,config);
            }
        } else {
            CharSequence big=n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            String body=string(big!=null?big:n.extras.getCharSequence(Notification.EXTRA_TEXT));
            emit(sbn,title,body,n.when>0?n.when:sbn.getPostTime(),config);
        }
    }
    private void emit(StatusBarNotification sbn,String title,String text,long time,Config config) {
        if(text.trim().isEmpty()||text.length()>16000)return;
        String hash;
        try{hash=hex(MessageDigest.getInstance("SHA-256").digest((sbn.getPackageName()+"|"+title+"|"+text+"|"+time).getBytes(StandardCharsets.UTF_8)));}catch(Exception e){return;}
        if(!recent.add(hash))return;
        // Persist identities only, never notification contents.
        config.prefs.edit().putStringSet("seen",recent.values()).apply();
        startService(new Intent(this,VoiceService.class).setAction(VoiceService.SPEAK).putExtra("title",title).putExtra("text",text));
    }
    private static String hex(byte[] bytes){StringBuilder b=new StringBuilder();for(byte v:bytes)b.append(String.format(Locale.ROOT,"%02x",v&255));return b.toString();}
    private static String string(CharSequence value){return value==null?"":value.toString();}
}
