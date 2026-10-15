import {AppError, DEFAULT_SETTINGS, requireUser, normalizeChannel, normalizeWords, validateSettings, textInput, formatSpokenText, parsePublicChannel, commandParts, VOICES, splitText} from './domain.js';
import {generateAudio} from './tts.js';

export function createService(store, {fetcher, api, defaultKey='', botUsername=''}) {
  async function keyFor(uid) {return (await store.get('SELECT api_key FROM secrets WHERE user_id=:u',{':u':uid}))?.api_key || defaultKey;}
  async function state(uid) {
    const p=await store.profile(uid), feed=await store.feed(uid);
    return {filterWords:p.words,voiceSettings:p.settings,revision:p.revision,trackedChannels:await store.listChannels(uid),...feed,ttsConfigured:!!(await keyFor(uid)),botUsername};
  }
  async function channels(uid,input) {
    const username=normalizeChannel(input.username);
    const params={':u':uid,':n':username};
    if(input.action==='add') {
      if((await store.listChannels(uid)).length>=20) throw new AppError('Максимум 20 каналов.');
      await store.run('INSERT INTO channels(user_id,username,title,active,cursor,checked_at,lease_until,error) VALUES(:u,:n,:t,1,0,0,0,\'\') ON CONFLICT(user_id,username) DO UPDATE SET active=1',{...params,':t':`@${username}`});
    } else if(input.action==='remove') await store.run('DELETE FROM channels WHERE user_id=:u AND username=:n',params);
    else if(input.action==='toggle') await store.run('UPDATE channels SET active=1-active WHERE user_id=:u AND username=:n',params);
    else throw new AppError('Неизвестное действие.');
    return {trackedChannels:await store.listChannels(uid)};
  }
  async function notify(uid, post) {
    if(!api) {await store.run('UPDATE posts SET notified=1 WHERE user_id=:u AND source_key=:k',{':u':uid,':k':post.key});return;}
    const p=await store.profile(uid);
    if(!p.settings.notify) {await store.run('UPDATE posts SET notified=1 WHERE user_id=:u AND source_key=:k',{':u':uid,':k':post.key});return;}
    // Claim before the external side effect. A negative value marks an uncertain
    // delivery after a crash, never automatically resend an uncertain result.
    const claim=await store.run('UPDATE posts SET notified=-1 WHERE user_id=:u AND source_key=:k AND notified=0',{':u':uid,':k':post.key});
    if(!claim.rowsAffected) return;
    try {
      const formatted=formatSpokenText(post.text,p.words,p.settings.nightMode);
      for(const part of splitText(`${post.title}\n\n${formatted.spokenText}`,3500)) await api.sendMessage({chat_id:uid,text:part});
      await store.run('UPDATE posts SET notified=1 WHERE user_id=:u AND source_key=:k',{':u':uid,':k':post.key});
    } catch(e) {
      // A definite Bot API rejection is safe to retry; network ambiguity is not.
      if(Number.isInteger(e?.code)) await store.run('UPDATE posts SET notified=:s WHERE user_id=:u AND source_key=:k',{':u':uid,':k':post.key,':s':[400,403].includes(e.code)?2:0});
      throw new AppError('Пост сохранён, но уведомление не доставлено. Проверьте /start и /status.','DELIVERY_FAILED');
    }
  }
  async function checkChannels(uid) {
    await store.quota(`check:${uid}`,2,60_000);
    let newPostsCount=0;
    const active=await store.all('SELECT * FROM channels WHERE user_id=:u AND active=1 ORDER BY checked_at LIMIT 5',{':u':uid});
    for(const c of active) {
      const now=Date.now(), params={':u':uid,':n':c.username};
      const claim=await store.run('UPDATE channels SET lease_until=:l WHERE user_id=:u AND username=:n AND lease_until<:now',{...params,':l':now+120_000,':now':now});
      if(!claim.rowsAffected) continue;
      try {
        const response=await fetcher(`https://t.me/s/${c.username}`,{headers:{'User-Agent':'VoiceReader/1.0'}});
        if(!response.ok) throw new AppError(`Канал недоступен: HTTP ${response.status}`);
        const html=await response.text();
        if(html.length>3_000_000) throw new AppError('Страница слишком большая.');
        const parsed=parsePublicChannel(html,c.username);
        if(!parsed.posts.length) throw new AppError('Публичные посты не найдены. Проверьте доступность канала.');
        const fresh=parsed.posts.filter(p=>p.messageId>c.cursor);
        // First check records a baseline; no surprise playback of old history.
        if(c.cursor) for(const post of fresh) {
          if(!post.text) continue;
          const data={key:`public:${c.username}:${post.messageId}`,username:c.username,title:parsed.title,text:post.text,date:post.date};
          if(await store.savePost(uid,data)) newPostsCount++;
          await store.run('UPDATE posts SET notified=1 WHERE user_id=:u AND source_key=:k AND notified=0',{':u':uid,':k':data.key});
        }
        const oldest=parsed.posts[0].messageId;
        const warning=c.cursor && oldest>c.cursor+1?'Возможен пропуск старых публикаций: публичная страница содержит только последние посты.':'';
        await store.run('UPDATE channels SET title=:t,cursor=:c,checked_at=:now,error=:e WHERE user_id=:u AND username=:n',{...params,':t':parsed.title,':c':parsed.posts.at(-1).messageId,':now':now,':e':warning});
      } catch(e) {
        await store.run('UPDATE channels SET checked_at=:now,error=:e WHERE user_id=:u AND username=:n',{...params,':now':now,':e':e instanceof AppError?e.message:'Не удалось проверить канал. Повторите позже.'});
      } finally {await store.run('UPDATE channels SET lease_until=0 WHERE user_id=:u AND username=:n AND lease_until=:lease',{...params,':lease':now+120_000});}
    }
    return {newPostsCount,trackedChannels:await store.listChannels(uid)};
  }
  async function call(name,input,user) {
    const uid=requireUser(user);
    await store.profile(uid);
    if(name==='getState') return state(uid);
    if(name==='getFeed') {const after=Number(input.after??0);if(!Number.isSafeInteger(after)||after<0) throw new AppError('Неверный курсор.');return store.feed(uid,after);}
    if(name==='saveSettings') {const p=await store.mutate(uid,p=>({...p,settings:{...p.settings,...validateSettings(input.settings)}}),input.revision);return {voiceSettings:p.settings,revision:p.revision};}
    if(name==='filterWords') {
      const p=await store.mutate(uid,p=>{
        let words=p.words;
        if(input.action==='add') words=normalizeWords([...words,...textInput(input.word,1000).split(',').map(w=>w.trim()).filter(Boolean)]);
        else if(input.action==='remove') words=words.filter(w=>w!==textInput(input.word,48).toLowerCase());
        else if(input.action==='clear') words=[];
        else if(input.action==='set') words=normalizeWords(input.words);
        else throw new AppError('Неизвестное действие.');
        return {...p,words};
      }); return {filterWords:p.words,revision:p.revision};
    }
    if(name==='manageChannel') return channels(uid,input);
    if(name==='checkChannels') return checkChannels(uid);
    if(name==='configureTts') {
      if(input.remove===true) await store.run('DELETE FROM secrets WHERE user_id=:u',{':u':uid});
      else {const key=textInput(input.key,200);if(!/^[A-Za-z0-9_-]{20,200}$/.test(key)) throw new AppError('Некорректный ключ Gemini.');await store.run('INSERT INTO secrets(user_id,api_key) VALUES(:u,:k) ON CONFLICT(user_id) DO UPDATE SET api_key=:k',{':u':uid,':k':key});}
      return {ttsConfigured:!!(await keyFor(uid))};
    }
    if(name==='tts') {
      const text=textInput(input.text,16_000), p=await store.profile(uid);
      await store.quota(`tts-minute:${uid}`,3,60_000);
      return generateAudio(fetcher,await keyFor(uid),text,input.voiceName??p.settings.voiceName,!!input.isNight,!!input.isAlert,()=>store.quota(`tts-provider-day:${uid}`,100,86_400_000));
    }
    if(name==='simulatePost') {
      await store.quota(`simulate:${uid}`,10,60_000);
      const text=textInput(input.text), id=textInput(input.requestId,100);
      await store.savePost(uid,{key:`test:${id}`,username:'test_channel',title:'Проверка озвучки',text,date:Date.now()});
      await store.run('UPDATE posts SET notified=1 WHERE user_id=:u AND source_key=:k',{':u':uid,':k':`test:${id}`});
      return store.feed(uid,Number(input.after)||0);
    }
    if(name==='executeCommand') return {reply:await command(uid,textInput(input.command,4096))};
    throw new AppError('Неизвестный запрос.','NOT_FOUND');
  }
  async function command(uid,text) {
    const {name,recipient,args}=commandParts(text);
    const username=botUsername||(api?(await api.getMe()).username:'');
    if(recipient && recipient!==username.toLowerCase()) return '';
    const user={id:uid};
    if(name==='/start'||name==='/help') return '🎙 Voice Reader\n/add слово — добавить триггер\n/remove слово · /list · /clear\n/channel add @канал · /channel remove @канал\n/channels · /check\n/night on|off · /voice Kore\n/test текст · /status\n\nПанель откройте через меню бота. Для чтения с погашенным экраном установите Android-компаньон и разрешите уведомления выбранных каналов. Публичные каналы проверяются по /check или из открытой панели.';
    if(name==='/list') return (await store.profile(uid)).words.join(', ')||'Фильтр пуст.';
    if(name==='/add') {await call('filterWords',{action:'add',word:args},user);return '✅ Слова добавлены.';}
    if(['/remove','/del','/clear'].includes(name)) {await call('filterWords',{action:name==='/clear'?'clear':'remove',word:args},user);return '✅ Фильтр обновлён.';}
    if(name==='/night') {const p=await store.profile(uid);if(args&&!['on','off'].includes(args)) throw new AppError('Используйте /night on или /night off.');await call('saveSettings',{settings:{nightMode:args?args==='on':!p.settings.nightMode}},user);return `🌙 Ночной режим ${(await store.profile(uid)).settings.nightMode?'включён':'выключен'}.`;}
    if(name==='/voice') {const voice=VOICES.find(v=>v.toLowerCase()===args.toLowerCase());if(!voice) throw new AppError(`Голоса: ${VOICES.join(', ')}`);await call('saveSettings',{settings:{voiceName:voice}},user);return `Голос: ${voice}`;}
    if(['/channel','/ch'].includes(name)) {const [action,channel]=args.split(/\s+/);await channels(uid,{action,username:channel});return '✅ Каналы обновлены.';}
    if(name==='/channels') return (await store.listChannels(uid)).map(c=>`@${c.username} — ${c.isActive?'включён':'пауза'}`).join('\n')||'Нет каналов. /channel add @username';
    if(name==='/check') return `Проверка завершена. Новых постов: ${(await checkChannels(uid)).newPostsCount}. Откройте ленту в панели.`;
    if(name==='/test') {await call('simulatePost',{text:args||'Внимание! Проверка озвучки.',requestId:`command-${Date.now()}`},user);return 'Тест добавлен в ленту Mini App. Android-компаньон проверяйте кнопкой «Тест» в приложении.';}
    if(name==='/status') {const uncertain=await store.get('SELECT count(*) AS n FROM posts WHERE user_id=:u AND notified=-1',{':u':uid});return `Каналов: ${(await store.listChannels(uid)).length}\nGemini: ${await keyFor(uid)?'настроен':'ключ не задан'}\nУведомлений с неопределённым результатом: ${uncertain.n}\nФоновое чтение: Android-компаньон, выбранные уведомления Telegram.`;}
    return 'Неизвестная команда. /help';
  }
  async function channelPost(message, edited=false) {
    const username=message.chat?.username?.toLowerCase();
    if(!username) return; // private sources require an explicit numeric subscription; never broadcast them globally
    const text=message.text??message.caption;
    if(typeof text!=='string'||!text.trim()) return;
    const subs=await store.all('SELECT user_id,title FROM channels WHERE username=:n AND active=1',{':n':username});
    const key=`public:${username}:${message.message_id}`;
    let failed=false;
    for(const sub of subs) {
      const data={key,username,title:message.chat.title||sub.title,text:textInput(text),date:(message.date??Math.floor(Date.now()/1000))*1000};
      await store.savePost(sub.user_id,data);
      if(edited) await store.run('UPDATE posts SET body=:b WHERE user_id=:u AND source_key=:k',{':u':sub.user_id,':k':key,':b':data.text});
      // Edits update the feed without repeating an already spoken alert.
      try {await notify(sub.user_id,data);} catch {failed=true;}
    }
    if(failed) throw new AppError('Часть уведомлений не доставлена; посты сохранены.','DELIVERY_FAILED');
  }
  return {call,command,channelPost};
}
