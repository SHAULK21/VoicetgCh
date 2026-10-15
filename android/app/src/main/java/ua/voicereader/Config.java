package ua.voicereader;

import android.content.*;
import org.json.*;
import java.util.*;

final class Config {
    static final String PREFS="reader";
    final SharedPreferences prefs;
    Config(Context ctx){prefs=ctx.getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    boolean enabled(){return prefs.getBoolean("enabled",false);}
    boolean night(){return prefs.getBoolean("night",false);}
    float rate(){return prefs.getFloat("rate",1f);}
    float pitch(){return prefs.getFloat("pitch",1f);}
    float nightVolume(){return prefs.getFloat("night_volume",0.28f);}
    float normalVolume(){return prefs.getFloat("normal_volume",0.60f);}
    float alertVolume(){return prefs.getFloat("alert_volume",1f);}
    boolean onlyKeywords(){return prefs.getBoolean("only_keywords",false);}
    boolean loudKeywords(){return prefs.getBoolean("loud_keywords",true);}
    Set<String> titles(){return ReaderRules.titles(prefs.getString("titles",""));}
    String wordText(){String value=prefs.getString("words",ReaderRules.DEFAULT_WORDS);return value.equals("внимание, срочно, тревога, важно")?ReaderRules.DEFAULT_WORDS:value;}
    Set<String> words(){return ReaderRules.lines(wordText());}
    void error(String error){prefs.edit().putString("status",error).apply();}
    void importJson(String raw)throws JSONException {
        JSONObject root=new JSONObject(raw);
        if(root.optInt("version")!=1)throw new JSONException("Невідомий формат налаштувань");
        JSONArray words=root.optJSONArray("filterWords"),titles=root.optJSONArray("notificationTitles");
        List<String> wordList=new ArrayList<>(),titleList=new ArrayList<>();
        if(words!=null)for(int i=0;i<Math.min(words.length(),40);i++)wordList.add(words.getString(i));
        if(titles!=null)for(int i=0;i<Math.min(titles.length(),40);i++)titleList.add(titles.getString(i));
        JSONObject voice=root.optJSONObject("voiceSettings");
        SharedPreferences.Editor e=prefs.edit().putString("words",String.join(", ",wordList)).putString("titles",String.join("\n",titleList));
        if(voice!=null)e.putBoolean("night",voice.optBoolean("nightMode",false)).putFloat("rate",(float)Math.max(0.75,Math.min(1.75,voice.optDouble("speechRate",1)))).putFloat("pitch",(float)Math.max(0.5,Math.min(1.5,1+voice.optDouble("pitch",0)/10))).putFloat("night_volume",(float)Math.max(0.15,Math.min(0.45,voice.optDouble("nightVolume",0.28))));
        e.apply();
    }
}
