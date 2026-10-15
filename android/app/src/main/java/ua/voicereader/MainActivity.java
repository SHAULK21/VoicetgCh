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
    private EditText titles,words;private Switch night;private SeekBar rate,pitch;private TextView status;
    private static final int IMPORT=4;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Runnable update=new Runnable(){public void run(){status.setText(getString(R.string.reader_status,getString(VoiceService.running?R.string.reader_running:R.string.reader_stopped),new Config(MainActivity.this).prefs.getString("status","Настройте доступ к уведомлениям и выберите каналы.")));main.postDelayed(this,2000);}};
    @Override public void onCreate(Bundle saved){super.onCreate(saved);build();}
    private void build() {
        ScrollView scroll=new ScrollView(this);LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);int pad=(int)(20*getResources().getDisplayMetrics().density);root.setPadding(pad,pad,pad,pad);scroll.addView(root);setContentView(scroll);
        if(Build.VERSION.SDK_INT>=35)root.setOnApplyWindowInsetsListener((view,insets)->{android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());view.setPadding(pad,pad+bars.top,pad,pad+bars.bottom);return insets;});
        label(root,"Voice Reader",26);label(root,"Чтение выбранных Telegram-уведомлений при выключенном экране",16);
        status=label(root,"",14);
        label(root,"1. В Telegram включите уведомления нужных каналов и предпросмотр текста. Android-компаньон читает только доступный текст уведомлений; скрытый или обрезанный текст получить не сможет.",14);
        button(root,"Разрешить доступ к уведомлениям",()->startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        label(root,"2. Точные названия каналов — каждое с новой строки. Используйте заголовки уведомлений, а не ссылки. Пустой список означает: ничего не читать. Не добавляйте названия личных чатов.",14);
        titles=input(root,"Например: Название моего канала",4);
        label(root,"Слова тревоги — через запятую",16);words=input(root,"срочно, тревога, важливо",3);
        night=new Switch(this);night.setText("Тихий ночной режим, кроме тревоги");root.addView(night);
        label(root,"Скорость: 0.75× — 1.75×",14);rate=new SeekBar(this);rate.setMax(100);root.addView(rate);
        label(root,"Тон: ниже — выше",14);pitch=new SeekBar(this);pitch.setMax(100);root.addView(pitch);
        button(root,"Сохранить настройки",()->{save();toast("Настройки сохранены");});
        button(root,"Импорт настроек из панели бота",()->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(i,IMPORT);});
        label(root,"3. Запустите службу при открытом приложении, затем погасите экран. Уведомление Voice Reader должно остаться. Системный голос выбирается в настройках TTS Android; голоса Gemini относятся к веб-панели.",14);
        button(root,"▶ Запустить чтение",()->start(false));button(root,"Проверить голос",()->start(true));
        button(root,"■ Остановить чтение",()->{new Config(this).prefs.edit().putBoolean("enabled",false).apply();stopService(new Intent(this,VoiceService.class));});
        button(root,"Настройки синтеза речи",()->{try{startActivity(new Intent("com.android.settings.TTS_SETTINGS"));}catch(Exception e){startActivity(new Intent(Settings.ACTION_SETTINGS));}});
        button(root,"Настройки батареи приложения",()->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getPackageName()))));
        label(root,"На Poco/Xiaomi разрешите приложению работу в фоне и выберите батарею «Без ограничений». Не отключайте службу в системном диспетчере. После перезагрузки запустите чтение снова. Системная громкость, беззвучный режим и настройки TTS влияют на слышимость.",14);
        label(root,"Приватность: приложение принимает только уведомления официального Telegram/Telegram X и читает лишь точные совпадения из списка. Интернет-доступ у компаньона отсутствует. Текст не сохраняется; используются только хеши для защиты от повторов. Выбранный системный движок TTS может использовать онлайн-голос.",13);
        load();
    }
    private boolean listenerAllowed(){String flat=Settings.Secure.getString(getContentResolver(),"enabled_notification_listeners");if(flat==null)return false;for(String item:flat.split(":")){ComponentName component=ComponentName.unflattenFromString(item);if(component!=null&&component.getPackageName().equals(getPackageName()))return true;}return false;}
    private void start(boolean test) {
        save();if(!test&&!listenerAllowed()){toast("Сначала разрешите доступ к уведомлениям");return;}
        if(!test&&new Config(this).titles().isEmpty()){toast("Добавьте точные названия каналов");return;}
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},7);toast("Разрешите уведомления и нажмите запуск ещё раз");return;}
        new Config(this).prefs.edit().putBoolean("enabled",true).apply();
        try{startForegroundService(new Intent(this,VoiceService.class).setAction(test?VoiceService.TEST:"START"));}catch(Exception e){new Config(this).prefs.edit().putBoolean("enabled",false).apply();toast("Не удалось запустить службу. Проверьте разрешения Android.");}
    }
    private void save(){new Config(this).prefs.edit().putString("titles",titles.getText().toString().trim()).putString("words",words.getText().toString().trim()).putBoolean("night",night.isChecked()).putFloat("rate",0.75f+rate.getProgress()/100f).putFloat("pitch",0.5f+pitch.getProgress()/100f).apply();}
    private void load(){Config c=new Config(this);titles.setText(c.prefs.getString("titles",""));words.setText(c.prefs.getString("words","внимание, срочно, тревога, важно"));night.setChecked(c.night());rate.setProgress(Math.round((c.rate()-0.75f)*100));pitch.setProgress(Math.round((c.pitch()-0.5f)*100));}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==IMPORT&&result==RESULT_OK&&data!=null&&data.getData()!=null){try(InputStream input=getContentResolver().openInputStream(data.getData())){if(input==null)throw new IOException();ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] chunk=new byte[4096];int count;while((count=input.read(chunk))!=-1){out.write(chunk,0,count);if(out.size()>65536)throw new IOException();}byte[] bytes=out.toByteArray();new Config(this).importJson(new String(bytes,StandardCharsets.UTF_8));load();toast("Импортировано. Проверьте названия каналов по уведомлениям.");}catch(Exception e){toast("Не удалось импортировать. Нужен файл настроек Voice Reader до 64 КБ.");}}}
    @Override protected void onResume(){super.onResume();main.post(update);}
    @Override protected void onPause(){main.removeCallbacks(update);super.onPause();}
    private TextView label(LinearLayout root,String text,int size){TextView v=new TextView(this);v.setText(text);v.setTextSize(size);v.setPadding(0,14,0,10);root.addView(v);return v;}
    private EditText input(LinearLayout root,String hint,int lines){EditText e=new EditText(this);e.setHint(hint);e.setMinLines(lines);e.setMaxLines(8);e.setTextSize(16);e.setGravity(Gravity.TOP);e.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);root.addView(e,new LinearLayout.LayoutParams(-1,-2));return e;}
    private void button(LinearLayout root,String label,Runnable action){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setMinHeight(52);b.setOnClickListener(v->action.run());root.addView(b,new LinearLayout.LayoutParams(-1,-2));}
    private void toast(String message){Toast.makeText(this,message,Toast.LENGTH_LONG).show();}
}
