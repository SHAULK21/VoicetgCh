package ua.voicereader;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private EditText titles,words;private Switch night,loudKeywords,onlyKeywords,skipLong;private SeekBar rate,pitch,normalVolume,alertVolume,maxLength;private TextView status,diagnostics,lifecycleStatus;
    private static final int IMPORT=4;
    private boolean loadingSettings;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Runnable update=new Runnable(){public void run(){status.setText(getString(R.string.reader_status,getString(VoiceService.running?R.string.reader_running:R.string.reader_stopped),new Config(MainActivity.this).prefs.getString("status","Налаштуйте доступ до сповіщень і виберіть канали.")));updateDiagnostics();main.postDelayed(this,2000);}};
    @Override public void onCreate(Bundle saved){super.onCreate(saved);build();}
    private void build() {
        ScrollView scroll=new ScrollView(this);LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);int pad=(int)(20*getResources().getDisplayMetrics().density);root.setPadding(pad,pad,pad,pad);scroll.addView(root);setContentView(scroll);
        if(Build.VERSION.SDK_INT>=35)root.setOnApplyWindowInsetsListener((view,insets)->{android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());view.setPadding(pad,pad+bars.top,pad,pad+bars.bottom);return insets;});
        label(root,"Voice Reader",26);label(root,"Читання вибраних сповіщень Telegram українською з вимкненим екраном",16);
        status=label(root,"",14);diagnostics=label(root,"",14);lifecycleStatus=label(root,"",14);
        button(root,"Перепідключити сповіщення",()->{if(!listenerAllowed()){startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));return;}if(ReaderNotifications.connected()){toast("Доступ уже підключено. Перевірте заголовок каналу нижче.");return;}ReaderNotifications.reconnect(this);toast("Запит підключення надіслано. Зачекайте кілька секунд.");});
        label(root,"1. У Telegram увімкніть сповіщення потрібних каналів та попередній перегляд тексту. Застосунок читає доступний текст сповіщень; прихований або обрізаний текст отримати не зможе.",14);
        button(root,"Дозволити доступ до сповіщень",()->startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        label(root,"2. Точні назви каналів — кожна з нового рядка. Використовуйте заголовки сповіщень, а не посилання. Порожній список означає: нічого не читати. Не додавайте назви особистих чатів.",14);
        titles=input(root,"Наприклад: Назва мого каналу",4);
        button(root,"Обрати зі сповіщень Telegram",this::chooseNotificationTitle);
        label(root,"Ключові слова або фрази — через кому",16);words=input(root,"терміново, тривога, важливо",3);
        onlyKeywords=new Switch(this);onlyKeywords.setText("Озвучувати лише ключові фрази");root.addView(onlyKeywords);
        label(root,"У цьому режимі звучать тільки знайдені фрази зі списку. Повний текст і повідомлення без збігів не озвучуються. Гучний акцент та три повтори можна вимкнути нижче.",14);
        skipLong=new Switch(this);skipLong.setText("Не читати довгі повідомлення");root.addView(skipLong);
        TextView lengthValue=label(root,getString(R.string.message_length_limit,500),14);
        maxLength=new SeekBar(this);maxLength.setMax(29);root.addView(maxLength);
        maxLength.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar bar,int progress,boolean user){lengthValue.setText(getString(R.string.message_length_limit,100+progress*100));if(user)voiceSettingChanged();}public void onStartTrackingTouch(SeekBar bar){}public void onStopTrackingTouch(SeekBar bar){}});
        label(root,"Повідомлення понад ліміт пропускаються повністю, навіть із ключовими фразами. Межа: 100–3000 символів. Перевіряється кожне нове повідомлення окремо, за доступним текстом сповіщення. Зміни зберігаються автоматично.",14);
        loudKeywords=new Switch(this);loudKeywords.setText("Екстрені фрази — гучно тричі; звичайний текст — один раз");root.addView(loudKeywords);
        label(root,"Лише фрази з вашого списку повторюються тричі. Звичайний текст повідомлення читається один раз. Спочатку — «Увага!» та знайдені фрази, потім — повідомлення. Гучність задається відносно медіагучності телефону; застосунок її не змінює. Це український голос, без автоматичного перекладу тексту.",14);
        label(root,"Гучність, нічний режим і параметри голосу зберігаються автоматично та діють із наступної озвучки. Назви каналів і список фраз збережіть кнопкою нижче.",14);
        normalVolume=volume(root,"Гучність звичайного читання",10,90);
        alertVolume=volume(root,"Гучність ключових слів",10,90);
        label(root,"Для помітного акценту залиште читання на 60%, а ключові слова — на 100%. Гучність слів не буде нижчою за звичайне читання.",14);
        night=new Switch(this);night.setText("Нічний режим: тихий текст, гучні ключові слова");root.addView(night);
        label(root,"Швидкість: 0.75× — 1.75×",14);rate=new SeekBar(this);rate.setMax(100);root.addView(rate);
        label(root,"Тон: нижче — вище",14);pitch=new SeekBar(this);pitch.setMax(100);root.addView(pitch);
        button(root,"Зберегти налаштування",()->{save();toast("Налаштування збережено");});
        button(root,"Імпорт налаштувань із панелі бота",()->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(i,IMPORT);});
        label(root,"3. Встановіть український голос у налаштуваннях синтезу мовлення Android. Натисніть «Перевірити голос», потім запустіть читання та вимкніть екран. Сповіщення Voice Reader має залишитися. APK працює самостійно, без панелі бота. Голоси Gemini доступні у вебпанелі.",14);
        button(root,"▶ Запустити читання",()->start(false));button(root,"Перевірити звичайну гучність",()->start(VoiceService.TEST_NORMAL));button(root,"Перевірити голос і ключові слова",()->start(true));
        button(root,"■ Зупинити читання",()->{new Config(this).prefs.edit().putBoolean("enabled",false).putString("service_event","Зупинено користувачем").apply();stopService(new Intent(this,VoiceService.class));});
        button(root,"Налаштування синтезу мовлення",()->{try{startActivity(new Intent("com.android.settings.TTS_SETTINGS"));}catch(Exception e){startActivity(new Intent(Settings.ACTION_SETTINGS));}});
        button(root,"Налаштування батареї застосунку",()->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getPackageName()))));
        button(root,"Економія батареї Android",()->startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)));
        label(root,"На Poco/Xiaomi дозвольте роботу у фоні та виберіть батарею «Без обмежень». Не вимикайте службу в системному диспетчері. Після перезавантаження запустіть читання знову. Медіагучність і налаштування TTS впливають на чутність.",14);
        label(root,"Приватність: застосунок приймає сповіщення офіційного Telegram/Telegram X і читає лише точні збіги зі списку. Доступу до інтернету немає. Текст повідомлень не зберігається; локально зберігаються хеші проти повторів та останній заголовок для діагностики. Системний синтезатор мовлення може використовувати онлайн-голос.",13);
        load();
        for(Switch toggle:new Switch[]{night,loudKeywords,onlyKeywords,skipLong})toggle.setOnCheckedChangeListener((button,checked)->{maxLength.setEnabled(skipLong.isChecked());voiceSettingChanged();});
        SeekBar.OnSeekBarChangeListener voiceListener=new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar bar,int progress,boolean user){if(user)voiceSettingChanged();}public void onStartTrackingTouch(SeekBar bar){}public void onStopTrackingTouch(SeekBar bar){}};
        rate.setOnSeekBarChangeListener(voiceListener);pitch.setOnSeekBarChangeListener(voiceListener);
    }
    private void updateDiagnostics(){
        Config c=new Config(this);
        PowerManager power=getSystemService(PowerManager.class);
        String battery=power.isIgnoringBatteryOptimizations(getPackageName())?"Android не оптимізує батарею застосунку":"Android може обмежувати фонову роботу";
        lifecycleStatus.setText(getString(R.string.service_health,battery,c.prefs.getString("service_event","Службу ще не запускали")));
        long at=c.prefs.getLong("last_notification_at",0);
        String when=at==0?"ще не отримано":android.text.format.DateFormat.getTimeFormat(this).format(new java.util.Date(at));
        diagnostics.setText(getString(R.string.notification_diagnostics,listenerAllowed()?"дозволено":"не дозволено",ReaderNotifications.connected()?"підключено":"немає з'єднання",when,c.prefs.getString("last_title","—"),c.prefs.getString("notification_status","Очікуємо нове сповіщення Telegram.")));
    }
    private void chooseNotificationTitle(){
        java.util.List<String> detected=ReaderNotifications.activeTitles();Config c=new Config(this);
        for(String key:new String[]{"last_title","last_raw_title"}){String title=c.prefs.getString(key,"");if(!title.trim().isEmpty()&&!detected.contains(title))detected.add(title);}
        if(detected.isEmpty()){toast("Заголовків ще немає. Дозвольте доступ до сповіщень, дочекайтеся нового повідомлення Telegram та спробуйте ще раз.");return;}
        new AlertDialog.Builder(this).setTitle("Оберіть канал. Особисті чати не додавайте.").setItems(detected.toArray(new String[0]),(dialog,index)->{
            String chosen=ReaderRules.normalizeTitle(detected.get(index));java.util.Set<String> allowed=ReaderRules.titles(titles.getText().toString());
            if(!allowed.contains(chosen)){String previous=titles.getText().toString().trim();titles.setText(previous.isEmpty()?chosen:previous+"\n"+chosen);}
            save();toast("Заголовок додано. Натисніть «Запустити читання» і перевірте НОВЕ повідомлення.");
        }).setNegativeButton("Скасувати",null).show();
    }
    private boolean listenerAllowed(){String flat=Settings.Secure.getString(getContentResolver(),"enabled_notification_listeners");if(flat==null)return false;for(String item:flat.split(":")){ComponentName component=ComponentName.unflattenFromString(item);if(component!=null&&component.getPackageName().equals(getPackageName()))return true;}return false;}
    private void start(boolean test){start(test?VoiceService.TEST:"START");}
    private void start(String action) {
        boolean test=VoiceService.TEST.equals(action)||VoiceService.TEST_NORMAL.equals(action);
        save();if(!test&&!listenerAllowed()){toast("Спочатку дозвольте доступ до сповіщень");return;}
        if(!test&&new Config(this).titles().isEmpty()){toast("Додайте точні назви каналів");return;}
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},7);toast("Дозвольте сповіщення та натисніть запуск ще раз");return;}
        if(listenerAllowed()&&!ReaderNotifications.connected())ReaderNotifications.reconnect(this);
        new Config(this).prefs.edit().putBoolean("enabled",true).apply();
        try{startForegroundService(new Intent(this,VoiceService.class).setAction(action));}catch(Exception e){new Config(this).prefs.edit().putBoolean("enabled",false).apply();toast("Не вдалося запустити службу. Перевірте дозволи Android.");}
    }
    private void save(){new Config(this).prefs.edit().putString("titles",titles.getText().toString().trim()).putString("words",words.getText().toString().trim()).apply();saveVoiceSettings();}
    private void voiceSettingChanged(){if(!loadingSettings)saveVoiceSettings();}
    private void saveVoiceSettings(){new Config(this).prefs.edit().putBoolean("skip_long",skipLong.isChecked()).putInt("max_message_length",100+maxLength.getProgress()*100).putBoolean("only_keywords",onlyKeywords.isChecked()).putBoolean("loud_keywords",loudKeywords.isChecked()).putFloat("normal_volume",(10+normalVolume.getProgress())/100f).putFloat("alert_volume",(10+alertVolume.getProgress())/100f).putBoolean("night",night.isChecked()).putFloat("rate",0.75f+rate.getProgress()/100f).putFloat("pitch",0.5f+pitch.getProgress()/100f).apply();}
    private void load(){loadingSettings=true;try{Config c=new Config(this);titles.setText(c.prefs.getString("titles",""));words.setText(c.wordText());skipLong.setChecked(c.skipLong());maxLength.setProgress((c.maxMessageLength()-100)/100);maxLength.setEnabled(c.skipLong());onlyKeywords.setChecked(c.onlyKeywords());loudKeywords.setChecked(c.loudKeywords());normalVolume.setProgress(Math.round(c.normalVolume()*100)-10);alertVolume.setProgress(Math.round(c.alertVolume()*100)-10);night.setChecked(c.night());rate.setProgress(Math.round((c.rate()-0.75f)*100));pitch.setProgress(Math.round((c.pitch()-0.5f)*100));}finally{loadingSettings=false;}}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==IMPORT&&result==RESULT_OK&&data!=null&&data.getData()!=null){try(InputStream input=getContentResolver().openInputStream(data.getData())){if(input==null)throw new IOException();ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] chunk=new byte[4096];int count;while((count=input.read(chunk))!=-1){out.write(chunk,0,count);if(out.size()>65536)throw new IOException();}byte[] bytes=out.toByteArray();new Config(this).importJson(new String(bytes,StandardCharsets.UTF_8));load();toast("Імпортовано. Перевірте назви каналів за сповіщеннями.");}catch(Exception e){toast("Не вдалося імпортувати. Потрібен файл налаштувань Voice Reader до 64 КБ.");}}}
    @Override protected void onResume(){super.onResume();main.post(update);}
    @Override protected void onPause(){main.removeCallbacks(update);super.onPause();}
    private SeekBar volume(LinearLayout root,String name,int min,int range){TextView value=label(root,getString(R.string.volume_percent,name,min),14);SeekBar bar=new SeekBar(this);bar.setMax(range);bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar b,int progress,boolean user){value.setText(getString(R.string.volume_percent,name,min+progress));if(user)voiceSettingChanged();}public void onStartTrackingTouch(SeekBar b){}public void onStopTrackingTouch(SeekBar b){}});root.addView(bar);return bar;}
    private TextView label(LinearLayout root,String text,int size){TextView v=new TextView(this);v.setText(text);v.setTextSize(size);v.setPadding(0,14,0,10);root.addView(v);return v;}
    private EditText input(LinearLayout root,String hint,int lines){EditText e=new EditText(this);e.setHint(hint);e.setMinLines(lines);e.setMaxLines(8);e.setTextSize(16);e.setGravity(Gravity.TOP);e.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);root.addView(e,new LinearLayout.LayoutParams(-1,-2));return e;}
    private void button(LinearLayout root,String label,Runnable action){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setMinHeight(52);b.setOnClickListener(v->action.run());root.addView(b,new LinearLayout.LayoutParams(-1,-2));}
    private void toast(String message){Toast.makeText(this,message,Toast.LENGTH_LONG).show();}
}
