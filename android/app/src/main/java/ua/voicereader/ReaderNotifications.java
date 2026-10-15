package ua.voicereader;

import android.app.Notification;
import android.content.*;
import android.os.*;
import android.service.notification.*;
import java.util.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

public final class ReaderNotifications extends NotificationListenerService {
    private static final Set<String> PACKAGES=new HashSet<>(Arrays.asList("org.telegram.messenger","org.telegram.messenger.web","org.telegram.messenger.beta","org.thunderdog.challegram"));
    private static ReaderNotifications active;
    static boolean connected(){return active!=null;}
    private final ReaderRules.Recent recent=new ReaderRules.Recent(200);
    @Override public void onListenerConnected(){
        active=this;recent.restore(new Config(this).prefs.getStringSet("seen",Collections.emptySet()));seedActive();
    }
    @Override public void onListenerDisconnected(){active=null;new Config(this).prefs.edit().putString("notification_status","Доступ від'єднано. Натисніть «Перепідключити сповіщення».").apply();}
    @Override public void onDestroy(){if(active==this)active=null;super.onDestroy();}
    static void seedBeforeReading(){if(active!=null)active.seedActive();}
    static void reconnect(Context context){try{requestRebind(new ComponentName(context,ReaderNotifications.class));}catch(SecurityException e){new Config(context).prefs.edit().putString("notification_status","Android не надав доступ. Увімкніть його в налаштуваннях сповіщень.").apply();}}
    static List<String> activeTitles(){
        Set<String> titles=new LinkedHashSet<>();if(active==null)return new ArrayList<>();
        try {StatusBarNotification[] current=active.getActiveNotifications();if(current!=null)for(StatusBarNotification sbn:current){
            if(!PACKAGES.contains(sbn.getPackageName())||(sbn.getNotification().flags&Notification.FLAG_GROUP_SUMMARY)!=0)continue;
            Bundle extras=sbn.getNotification().extras;if(extras==null)continue;
            String title=ReaderRules.selectTitle(string(extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)),string(extras.getCharSequence(Notification.EXTRA_TITLE)),Collections.emptySet());
            if(!title.trim().isEmpty())titles.add(title);
        }}catch(SecurityException|IllegalStateException e){return new ArrayList<>();}
        return new ArrayList<>(titles);
    }
    private void seedActive(){
        // Snapshot already visible notifications, rather than rejecting new deliveries
        // because their source timestamp predates the start of the speech service.
        try {
            StatusBarNotification[] notifications=getActiveNotifications();
            if(notifications!=null)for(StatusBarNotification sbn:notifications)if(PACKAGES.contains(sbn.getPackageName()))process(sbn,true);
        }catch(SecurityException|IllegalStateException e){new Config(this).prefs.edit().putString("notification_status","Не вдалося перевірити доступ. Перепідключіть сповіщення.").apply();}
    }
    @Override public void onNotificationPosted(StatusBarNotification sbn){if(PACKAGES.contains(sbn.getPackageName()))process(sbn,false);}
    private void process(StatusBarNotification sbn,boolean baseline){
        Config config=new Config(this);Notification n=sbn.getNotification();Bundle extras=n.extras;
        if(extras==null){if(!baseline)diagnostic(config, "У сповіщенні немає даних.");return;}
        String conversation=string(extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE));
        String raw=string(extras.getCharSequence(Notification.EXTRA_TITLE));
        String title=ReaderRules.selectTitle(conversation,raw,config.titles());
        if((n.flags&Notification.FLAG_GROUP_SUMMARY)!=0)return;
        if(!baseline)config.prefs.edit().putString("last_title",title).putString("last_raw_title",raw).putLong("last_notification_at",System.currentTimeMillis()).apply();
        if(!baseline&&!config.enabled()){diagnostic(config,"Читання вимкнено. Натисніть «Запустити читання».");return;}
        if(!baseline&&!ReaderRules.accepts(title,config.titles())){diagnostic(config,"Назва не збігається зі списком каналів. Додайте фактичний заголовок кнопкою нижче.");return;}
        if(!baseline&&!VoiceService.running){diagnostic(config,"Службу зупинено системою. Запустіть читання знову.");return;}
        List<Incoming> messages=messages(extras);
        int count=0;
        for(Incoming message:messages){String text=message.text;if(!text.trim().isEmpty()){count++;emit(sbn,title,text,message.time,config,baseline);}}
        if(count==0){
            String body=string(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
            if(body.trim().isEmpty())body=string(extras.getCharSequence(Notification.EXTRA_TEXT));
            if(body.trim().isEmpty()){CharSequence[] lines=extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);if(lines!=null)for(CharSequence line:lines)body+=string(line)+"\n";}
            if(body.trim().isEmpty()){if(!baseline)diagnostic(config,"Telegram не передав текст. Увімкніть попередній перегляд сповіщень у Telegram.");return;}
            emit(sbn,title,body,n.when>0?n.when:sbn.getPostTime(),config,baseline);
        }
    }
    private static final class Incoming {final String text;final long time;Incoming(String text,long time){this.text=text;this.time=time;}}
    private static List<Incoming> messages(Bundle extras){
        List<Incoming> result=new ArrayList<>();Parcelable[] bundles=extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        if(bundles==null)return result;
        if(Build.VERSION.SDK_INT>=30){for(Notification.MessagingStyle.Message message:Notification.MessagingStyle.Message.getMessagesFromBundleArray(bundles))result.add(new Incoming(string(message.getText()),message.getTimestamp()));}
        else for(Parcelable item:bundles)if(item instanceof Bundle){Bundle message=(Bundle)item;result.add(new Incoming(string(message.getCharSequence("text")),message.getLong("time",0)));}
        return result;
    }
    private void emit(StatusBarNotification sbn,String title,String text,long time,Config config,boolean baseline){
        if(text.length()>16000){if(!baseline)diagnostic(config,"Текст перевищує ліміт 16000 символів.");return;}
        String hash;
        try{hash=hex(MessageDigest.getInstance("SHA-256").digest((sbn.getPackageName()+"|"+ReaderRules.normalizeTitle(title)+"|"+text+"|"+time).getBytes(StandardCharsets.UTF_8)));}catch(Exception e){return;}
        if(!recent.add(hash)){if(!baseline)diagnostic(config,"Повтор уже отриманого повідомлення пропущено.");return;}
        if(!baseline)try {
            startService(new Intent(this,VoiceService.class).setAction(VoiceService.SPEAK).putExtra("title",title).putExtra("text",text));
            diagnostic(config,"Текст передано на озвучення.");
        }catch(IllegalStateException|SecurityException e){recent.remove(hash);diagnostic(config,"Android заблокував передачу тексту службі. Відкрийте застосунок і запустіть читання знову.");}
        // Store identities and diagnostic titles only, never notification bodies.
        config.prefs.edit().putStringSet("seen",recent.values()).apply();
    }
    private void diagnostic(Config config,String reason){config.prefs.edit().putString("notification_status",reason).apply();}
    private static String hex(byte[] bytes){StringBuilder b=new StringBuilder();for(byte v:bytes)b.append(String.format(Locale.ROOT,"%02x",v&255));return b.toString();}
    private static String string(CharSequence value){return value==null?"":value.toString();}
}
