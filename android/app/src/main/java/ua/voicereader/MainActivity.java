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
    private EditText titles,words;private Switch night,loudKeywords;private SeekBar rate,pitch,normalVolume,alertVolume;private TextView status;
    private static final int IMPORT=4;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Runnable update=new Runnable(){public void run(){status.setText(getString(R.string.reader_status,getString(VoiceService.running?R.string.reader_running:R.string.reader_stopped),new Config(MainActivity.this).prefs.getString("status","Налаштуйте доступ до сповіщень і виберіть канали.")));main.postDelayed(this,2000);}};
    @Override public void onCreate(Bundle saved){super.onCreate(saved);build();}
    private void build() {
        ScrollView scroll=new ScrollView(this);LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);int pad=(int)(20*getResources().getDisplayMetrics().density);root.setPadding(pad,pad,pad,pad);scroll.addView(root);setContentView(scroll);
        if(Build.VERSION.SDK_INT>=35)root.setOnApplyWindowInsetsListener((view,insets)->{android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());view.setPadding(pad,pad+bars.top,pad,pad+bars.bottom);return insets;});
        label(root,"Voice Reader",26);label(root,"Читання вибраних сповіщень Telegram українською з вимкненим екраном",16);
        status=label(root,"",14);
        label(root,"1. У Telegram увімкніть сповіщення потрібних каналів та попередній перегляд тексту. Застосунок читає доступний текст сповіщень; прихований або обрізаний текст отримати не зможе.",14);
        button(root,"Дозволити доступ до сповіщень",()->startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        label(root,"2. Точні назви каналів — кожна з нового рядка. Використовуйте заголовки сповіщень, а не посилання. Порожній список означає: нічого не читати. Не додавайте назви особистих чатів.",14);
        titles=input(root,"Наприклад: Назва мого каналу",4);
        label(root,"Ключові слова або фрази — через кому",16);words=input(root,"терміново, тривога, важливо",3);
        loudKeywords=new Switch(this);loudKeywords.setText("Гучно озвучувати ключові слова тричі");root.addView(loudKeywords);
        label(root,"Спочатку — «Увага!» та знайдені слова, потім — повідомлення. Гучність задається відносно медіагучності телефону; застосунок її не змінює. Це український голос, без автоматичного перекладу тексту.",14);
        normalVolume=volume(root,"Гучність звичайного читання",10,90);
        alertVolume=volume(root,"Гучність ключових слів",10,90);
        label(root,"Для помітного акценту залиште читання на 60%, а ключові слова — на 100%. Гучність слів не буде нижчою за звичайне читання.",14);
        night=new Switch(this);night.setText("Нічний режим: тихий текст, гучні ключові слова");root.addView(night);
        label(root,"Швидкість: 0.75× — 1.75×",14);rate=new SeekBar(this);rate.setMax(100);root.addView(rate);
        label(root,"Тон: нижче — вище",14);pitch=new SeekBar(this);pitch.setMax(100);root.addView(pitch);
        button(root,"Зберегти налаштування",()->{save();toast("Налаштування збережено");});
        button(root,"Імпорт налаштувань із панелі бота",()->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(i,IMPORT);});
        label(root,"3. Встановіть український голос у налаштуваннях синтезу мовлення Android. Натисніть «Перевірити голос», потім запустіть читання та вимкніть екран. Сповіщення Voice Reader має залишитися. APK працює самостійно, без панелі бота. Голоси Gemini доступні у вебпанелі.",14);
        button(root,"▶ Запустити читання",()->start(false));button(root,"Перевірити голос і ключові слова",()->start(true));
        button(root,"■ Зупинити читання",()->{new Config(this).prefs.edit().putBoolean("enabled",false).apply();stopService(new Intent(this,VoiceService.class));});
        button(root,"Налаштування синтезу мовлення",()->{try{startActivity(new Intent("com.android.settings.TTS_SETTINGS"));}catch(Exception e){startActivity(new Intent(Settings.ACTION_SETTINGS));}});
        button(root,"Налаштування батареї застосунку",()->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getPackageName()))));
        label(root,"На Poco/Xiaomi дозвольте роботу у фоні та виберіть батарею «Без обмежень». Не вимикайте службу в системному диспетчері. Після перезавантаження запустіть читання знову. Медіагучність і налаштування TTS впливають на чутність.",14);
        label(root,"Приватність: застосунок приймає сповіщення офіційного Telegram/Telegram X і читає лише точні збіги зі списку. Доступу до інтернету немає. Текст не зберігається; використовуються лише хеші проти повторів. Системний синтезатор мовлення може використовувати онлайн-голос.",13);
        load();
    }
    private boolean listenerAllowed(){String flat=Settings.Secure.getString(getContentResolver(),"enabled_notification_listeners");if(flat==null)return false;for(String item:flat.split(":")){ComponentName component=ComponentName.unflattenFromString(item);if(component!=null&&component.getPackageName().equals(getPackageName()))return true;}return false;}
    private void start(boolean test) {
        save();if(!test&&!listenerAllowed()){toast("Спочатку дозвольте доступ до сповіщень");return;}
        if(!test&&new Config(this).titles().isEmpty()){toast("Додайте точні назви каналів");return;}
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},7);toast("Дозвольте сповіщення та натисніть запуск ще раз");return;}
        new Config(this).prefs.edit().putBoolean("enabled",true).apply();
        try{startForegroundService(new Intent(this,VoiceService.class).setAction(test?VoiceService.TEST:"START"));}catch(Exception e){new Config(this).prefs.edit().putBoolean("enabled",false).apply();toast("Не вдалося запустити службу. Перевірте дозволи Android.");}
    }
    private void save(){new Config(this).prefs.edit().putString("titles",titles.getText().toString().trim()).putString("words",words.getText().toString().trim()).putBoolean("loud_keywords",loudKeywords.isChecked()).putFloat("normal_volume",(10+normalVolume.getProgress())/100f).putFloat("alert_volume",(10+alertVolume.getProgress())/100f).putBoolean("night",night.isChecked()).putFloat("rate",0.75f+rate.getProgress()/100f).putFloat("pitch",0.5f+pitch.getProgress()/100f).apply();}
    private void load(){Config c=new Config(this);titles.setText(c.prefs.getString("titles",""));words.setText(c.wordText());loudKeywords.setChecked(c.loudKeywords());normalVolume.setProgress(Math.round(c.normalVolume()*100)-10);alertVolume.setProgress(Math.round(c.alertVolume()*100)-10);night.setChecked(c.night());rate.setProgress(Math.round((c.rate()-0.75f)*100));pitch.setProgress(Math.round((c.pitch()-0.5f)*100));}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==IMPORT&&result==RESULT_OK&&data!=null&&data.getData()!=null){try(InputStream input=getContentResolver().openInputStream(data.getData())){if(input==null)throw new IOException();ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] chunk=new byte[4096];int count;while((count=input.read(chunk))!=-1){out.write(chunk,0,count);if(out.size()>65536)throw new IOException();}byte[] bytes=out.toByteArray();new Config(this).importJson(new String(bytes,StandardCharsets.UTF_8));load();toast("Імпортовано. Перевірте назви каналів за сповіщеннями.");}catch(Exception e){toast("Не вдалося імпортувати. Потрібен файл налаштувань Voice Reader до 64 КБ.");}}}
    @Override protected void onResume(){super.onResume();main.post(update);}
    @Override protected void onPause(){main.removeCallbacks(update);super.onPause();}
    private SeekBar volume(LinearLayout root,String name,int min,int range){TextView value=label(root,getString(R.string.volume_percent,name,min),14);SeekBar bar=new SeekBar(this);bar.setMax(range);bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar b,int progress,boolean user){value.setText(getString(R.string.volume_percent,name,min+progress));}public void onStartTrackingTouch(SeekBar b){}public void onStopTrackingTouch(SeekBar b){}});root.addView(bar);return bar;}
    private TextView label(LinearLayout root,String text,int size){TextView v=new TextView(this);v.setText(text);v.setTextSize(size);v.setPadding(0,14,0,10);root.addView(v);return v;}
    private EditText input(LinearLayout root,String hint,int lines){EditText e=new EditText(this);e.setHint(hint);e.setMinLines(lines);e.setMaxLines(8);e.setTextSize(16);e.setGravity(Gravity.TOP);e.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);root.addView(e,new LinearLayout.LayoutParams(-1,-2));return e;}
    private void button(LinearLayout root,String label,Runnable action){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setMinHeight(52);b.setOnClickListener(v->action.run());root.addView(b,new LinearLayout.LayoutParams(-1,-2));}
    private void toast(String message){Toast.makeText(this,message,Toast.LENGTH_LONG).show();}
}
