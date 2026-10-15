import {DEFAULT_SETTINGS, DEFAULT_WORDS, AppError, formatSpokenText} from './domain.js';
// Raw SQL deliberately shares the exact contract between tgcloud SQLite and
// node:sqlite. Mutations use SQLite constraints/CAS instead of JS global state.
export function createStorage(db) {
  const run = (q, p={})=>db.run(q,p);
  const get = (q,p={})=>db.get(q,p);
  const all = (q,p={})=>db.all(q,p);
  async function profile(uid) {
    await run('INSERT INTO profiles(user_id,settings,words,revision) VALUES(:u,:s,:w,0) ON CONFLICT(user_id) DO NOTHING', {':u':uid,':s':JSON.stringify(DEFAULT_SETTINGS),':w':JSON.stringify(DEFAULT_WORDS)});
    const row = await get('SELECT * FROM profiles WHERE user_id=:u',{':u':uid});
    return {settings:{...DEFAULT_SETTINGS,...JSON.parse(row.settings)},words:JSON.parse(row.words),revision:row.revision};
  }
  async function mutate(uid, change, expected) {
    for(let tries=0;tries<5;tries++) {
      const old = await profile(uid);
      if (expected !== undefined && expected !== old.revision) throw new AppError('Настройки изменились. Обновите панель.', 'CONFLICT');
      const next = change(old);
      const result = await run('UPDATE profiles SET settings=:s,words=:w,revision=revision+1 WHERE user_id=:u AND revision=:r', {':u':uid,':r':old.revision,':s':JSON.stringify(next.settings),':w':JSON.stringify(next.words)});
      if (result.rowsAffected) return {...next,revision:old.revision+1};
    }
    throw new AppError('Повторите изменение.', 'CONFLICT');
  }
  async function quota(bucket, max, duration) {
    const now=Date.now(), key=`${bucket}:${Math.floor(now/duration)}`;
    await run('INSERT INTO limits(bucket,used,expires) VALUES(:b,0,:e) ON CONFLICT(bucket) DO NOTHING',{':b':key,':e':now+duration*2});
    const result = await run('UPDATE limits SET used=used+1 WHERE bucket=:b AND used<:m',{':b':key,':m':max});
    if(!result.rowsAffected) throw new AppError('Лимит запросов исчерпан. Попробуйте позже.','RATE_LIMIT');
    await run('DELETE FROM limits WHERE expires<:n',{':n':now});
  }
  async function listChannels(uid) {
    return (await all('SELECT * FROM channels WHERE user_id=:u ORDER BY username',{':u':uid})).map(c=>({username:c.username,title:c.title,isActive:!!c.active,lastPostId:c.cursor?`${c.username}/${c.cursor}`:undefined,lastChecked:c.checked_at||undefined,error:c.error||undefined}));
  }
  async function savePost(uid, post) {
    const result = await run('INSERT INTO posts(user_id,source_key,username,title,body,date,notified) VALUES(:u,:k,:n,:t,:b,:d,0) ON CONFLICT(user_id,source_key) DO NOTHING',{':u':uid,':k':post.key,':n':post.username,':t':post.title,':b':post.text,':d':post.date});
    // Keep bounded history. Never remove an undelivered row during a retry.
    await run('DELETE FROM posts WHERE user_id=:u AND notified IN (1,2) AND id NOT IN (SELECT id FROM posts WHERE user_id=:u ORDER BY id DESC LIMIT 200)',{':u':uid});
    return !!result.rowsAffected;
  }
  async function feed(uid, after=0) {
    const p=await profile(uid);
    const rows=after ? await all('SELECT * FROM posts WHERE user_id=:u AND id>:a ORDER BY id LIMIT 50',{':u':uid,':a':after}) : (await all('SELECT * FROM posts WHERE user_id=:u ORDER BY id DESC LIMIT 50',{':u':uid})).reverse();
    return {messages:rows.map(row=>({id:String(row.id),channelTitle:row.title,channelUsername:row.username.startsWith('@')?row.username:`@${row.username}`,text:row.body,date:row.date,timestamp:new Date(row.date).toISOString(),...formatSpokenText(row.body,p.words,p.settings.nightMode)})),cursor:rows.at(-1)?.id??after};
  }
  return {run,get,all,profile,mutate,quota,listChannels,savePost,feed};
}
