import {AppError, splitText, VOICES} from './domain.js';
export async function generateAudio(fetcher, key, text, voice, night, alert, consume=async()=>{}) {
  if(!key) throw new AppError('Добавьте ключ Gemini в настройках или выберите системный голос.','TTS_UNAVAILABLE');
  if(!VOICES.includes(voice)) throw new AppError('Неизвестный голос.');
  const style=alert?'Speak emphatically and urgently in the language of the text.':night?'Speak softly and calmly in the language of the text.':'Speak naturally and clearly in the language of the text.';
  const chunks=[];
  for(const part of splitText(text)) {
    await consume();
    const response=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent',{
      method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({contents:[{role:'user',parts:[{text:part,speechMetadata:{style}}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{voice}}}}),
    });
    if(!response.ok) throw new AppError(response.status===429?'Gemini временно ограничил запросы.':'Не удалось получить аудио Gemini.',response.status===429?'RATE_LIMIT':'TTS_UNAVAILABLE');
    const data=await response.json();
    const audio=data.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data)?.inlineData;
    if(!audio?.data || !/audio\/(wav|x-wav|L16|pcm)/i.test(audio.mimeType??'')) throw new AppError('Gemini вернул неподдерживаемое аудио.','TTS_UNAVAILABLE');
    // Bound retained output; raw provider errors and credentials never reach UI.
    if(audio.data.length>12_000_000 || chunks.reduce((n,c)=>n+c.audioBase64.length,0)+audio.data.length>24_000_000) throw new AppError('Аудио слишком большое. Уменьшите текст.');
    chunks.push({audioBase64:audio.data,mimeType:audio.mimeType});
  }
  return {chunks};
}
