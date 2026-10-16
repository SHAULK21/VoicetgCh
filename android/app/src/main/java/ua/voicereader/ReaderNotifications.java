package ua.voicereader;

import android.app.Notification;
import android.content.*;
import android.os.*;
import android.service.notification.*;
import java.util.*;

public final class ReaderNotifications extends NotificationListenerService {
    private static final Set<String> PACKAGES=new HashSet<>(Arrays.asList("org.telegram.messenger","org.telegram.messenger.web","org.telegram.messenger.beta","org.thunderdog.challegram"));
    private static ReaderNotifications active;
    private final Handler reconnectHandler=new Handler(Looper.getMainLooper());
    private final Runnable reconnectOnce=()->{if(new Config(this).enabled()&&active==null)reconnect(this);};
    static boolean connected(){return active!=null;}
    private final NotificationHistory history=new NotificationHistory(200,40,100);
    @Override public void onListenerConnected(){
        reconnectHandler.removeCallbacks(reconnectOnce);active=this;history.restore(new Config(this).prefs.getStringSet("seen",Collections.emptySet()));seedActive();
    }
    @Override public void onListenerDisconnected(){active=null;new Config(this).prefs.edit().putString("notification_status","Доступ від'єднано. Запитуємо повторне підключення.").apply();reconnectHandler.removeCallbacks(reconnectOnce);if(new Config(this).enabled())reconnectHandler.postDelayed(reconnectOnce,5000);}
    @Override public void onDestroy(){reconnectHandler.removeCallbacks(reconnectOnce);if(active==this)active=null;super.onDestroy();}
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
    @Override public void onNotificationRemoved(StatusBarNotification sbn){if(PACKAGES.contains(sbn.getPackageName()))history.forget(sbn.getPackageName()+"|"+sbn.getKey());}
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
        List<Incoming> incoming=messages(extras),messages=new ArrayList<>();
        for(Incoming message:incoming)if(!message.text.trim().isEmpty())messages.add(message);
        boolean structured=!messages.isEmpty();String fallbackDiscriminator="";
        if(!structured){
            CharSequence[] inbox=extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
            if(inbox!=null)for(CharSequence line:inbox)if(!string(line).trim().isEmpty())messages.add(new Incoming(string(line),sbn.getPostTime()));
            if(!messages.isEmpty())fallbackDiscriminator="inbox:";
            else{
                String body=string(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
                if(body.trim().isEmpty())body=string(extras.getCharSequence(Notification.EXTRA_TEXT));
                if(body.trim().isEmpty()){if(!baseline)diagnostic(config,"Telegram не передав текст. Увімкніть попередній перегляд сповіщень у Telegram.");return;}
                messages.add(new Incoming(body,n.when>0?n.when:sbn.getPostTime()));
            }
        }
        String scope=sbn.getPackageName()+"|"+sbn.getKey();List<String> lines=new ArrayList<>();
        for(Incoming message:messages)lines.add(ReaderRules.normalizeTitle(title)+"|"+message.text);
        // Reposting a plain notification may change both 'when' and postTime without adding a message.
        // Content snapshots also bridge a plain/Inbox/MessagingStyle change on the same notification.
        Set<Integer> fresh=new HashSet<>();
        if(structured&&history.wasStructured(scope)){for(int i=0;i<messages.size();i++)fresh.add(i);}
        else fresh.addAll(history.freshIndexes(scope,lines));
        if(!baseline&&fresh.isEmpty())diagnostic(config,"Оновлення сповіщення без нових повідомлень: повтор пропущено.");
        boolean[] handled=new boolean[messages.size()];Map<String,Integer> occurrences=new HashMap<>();
        for(int i=0;i<handled.length;i++)handled[i]=!fresh.contains(i);
        for(int i=0;i<messages.size();i++){
            Incoming message=messages.get(i);String discriminator=fallbackDiscriminator.isEmpty()?"":fallbackDiscriminator+i;
            if(structured){String identity=NotificationHistory.fingerprint(message.text+"|"+message.time);int occurrence=occurrences.getOrDefault(identity,0);occurrences.put(identity,occurrence+1);discriminator=occurrence==0?"":"occurrence:"+occurrence;}
            boolean alreadyHandled=!fresh.contains(i);
            if(!emit(sbn,title,message.text,message.time,discriminator,config,baseline||alreadyHandled,structured))break;
            handled[i]=true;
        }
        List<String> committed=new ArrayList<>();for(int i=0;i<lines.size();i++)if(handled[i])committed.add(lines.get(i));
        history.remember(scope,committed,committed.size(),structured);
        config.prefs.edit().putStringSet("seen",history.ids()).apply();
    }
    private static final class Incoming {final String text;final long time;Incoming(String text,long time){this.text=text;this.time=time;}}
    private static List<Incoming> messages(Bundle extras){
        List<Incoming> result=new ArrayList<>();Parcelable[] bundles=extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        if(bundles==null)return result;
        if(Build.VERSION.SDK_INT>=30){for(Notification.MessagingStyle.Message message:Notification.MessagingStyle.Message.getMessagesFromBundleArray(bundles))result.add(new Incoming(string(message.getText()),message.getTimestamp()));}
        else for(Parcelable item:bundles)if(item instanceof Bundle){Bundle message=(Bundle)item;result.add(new Incoming(string(message.getCharSequence("text")),message.getLong("time",0)));}
        return result;
    }
    private boolean emit(StatusBarNotification sbn,String title,String text,long time,String discriminator,Config config,boolean baseline,boolean structured){
        if(text.length()>16000){if(!baseline)diagnostic(config,"Текст перевищує ліміт 16000 символів.");return true;}
        String hash=history.messageId(sbn.getPackageName(),title,text,time,discriminator);
        if(!history.claim(hash)){if(!baseline)diagnostic(config,"Повтор уже отриманого повідомлення пропущено.");return true;}
        if(baseline)return true;
        String scope=sbn.getPackageName()+"|"+sbn.getKey();long received=SystemClock.elapsedRealtime();
        if(history.isMirror(sbn.getPackageName(),title,text,scope,time,structured,received)){diagnostic(config,"Копію повідомлення в іншому сповіщенні пропущено.");return true;}
        if(config.tooLong(text)){diagnostic(config,config.lengthSkipReason());return true;}
        if(config.onlyKeywords()&&ReaderRules.matched(text,config.words()).isEmpty()){diagnostic(config,"Збігів ключових фраз немає: повідомлення без звуку.");return true;}
        try {
            startService(new Intent(this,VoiceService.class).setAction(VoiceService.SPEAK).putExtra("title",title).putExtra("text",text).putExtra("delivery_id",hash));
            history.delivered(sbn.getPackageName(),title,text,scope,time,structured,received);
            diagnostic(config,config.onlyKeywords()?"На озвучення передано тільки знайдені ключові фрази.":"Текст передано на озвучення.");return true;
        }catch(IllegalStateException|SecurityException e){history.retry(hash);diagnostic(config,"Android заблокував передачу тексту службі. Відкрийте застосунок і запустіть читання знову.");return false;}
    }
    private void diagnostic(Config config,String reason){config.prefs.edit().putString("notification_status",reason).apply();}
    private static String string(CharSequence value){return value==null?"":value.toString();}
}
