import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../local/database.js';
import {createStorage} from '../tgcloud/lib/storage.js';
import {createService} from '../tgcloud/lib/service.js';
import {normalizeChannel,formatSpokenText,parsePublicChannel,splitText} from '../tgcloud/lib/domain.js';
const u={id:1},other={id:2};
function setup(options={}) {const db=openDatabase(':memory:'),store=createStorage(db),service=createService(store,{fetcher:async()=>{throw Error('Unexpected external request');},botUsername:'ExampleBot',...options});return {db,store,service};}
const html=(id,text='')=>`<div class="tgme_widget_message js-widget_message" data-post="example/${id}">${text?`<div class="tgme_widget_message_text js-message_text">${text}</div>`:'<a class="tgme_widget_message_photo_wrap"></a>'}</div>`;
test('channel normalization accepts common links; rejects arbitrary hosts, paths and invalid input',()=>{
  for(const value of ['@Example','t.me/example','https://t.me/s/Example/'])assert.equal(normalizeChannel(value),'example');
  for(const value of ['https://evil.example/example','https://t.me/example/123','t.me/+private','../etc',''])assert.throws(()=>normalizeChannel(value));
});
test('three repetitions and lossless segmentation, including surrogate pairs',()=>{
  const r=formatSpokenText('СрОчНо новость',['срочно','СРОЧНО'],true);assert.equal(r.matchedWords.length,1);assert.equal(r.spokenText.match(/СРОЧНО!/g).length,3);assert.equal(r.isNightMode,false);
  const text=('текст😀 '.repeat(2000));assert.equal(splitText(text).join(''),text);for(const p of splitText(text))assert.ok(p.length<=1200);
});
test('HTML media-only block cannot capture next message text',()=>{
  const r=parsePublicChannel(html(10)+html(11,'Hello &amp; &#x1F600;'),'example');
  assert.equal(r.posts.length,2);assert.equal(r.posts[0].text,'');assert.equal(r.posts[1].messageId,11);assert.equal(r.posts[1].text,'Hello & 😀');
});
test('settings isolated by verified identity; payload cannot choose another owner',async t=>{
  const {service,db}=setup();t.after(()=>db.close());
  await service.call('filterWords',{action:'add',word:'owner_only',user_id:2},u);
  assert.ok((await service.call('getState',{},u)).filterWords.includes('owner_only'));
  assert.ok(!(await service.call('getState',{},other)).filterWords.includes('owner_only'));
  await assert.rejects(service.call('getState',{},{}),{code:'UNAUTHORIZED'});
});
test('settings survive reopening the database',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'voice-reader-')),path=join(dir,'db.sqlite');
  let db=openDatabase(path),store=createStorage(db);await store.mutate(1,p=>({...p,words:['persistent']}));db.close();
  db=openDatabase(path);try{assert.deepEqual((await createStorage(db).profile(1)).words,['persistent']);}finally{db.close();rmSync(dir,{recursive:true});}
});
test('CAS conflicts and concurrent word additions cannot silently overwrite settings',async t=>{
  const {service,store,db}=setup();t.after(()=>db.close());await store.profile(1);
  await Promise.all(['alpha','beta'].map(word=>service.call('filterWords',{action:'add',word},u)));
  const state=await service.call('getState',{},u);assert.ok(state.filterWords.includes('alpha'));assert.ok(state.filterWords.includes('beta'));
  await assert.rejects(service.call('saveSettings',{settings:{nightMode:true},revision:0},u),{code:'CONFLICT'});
  await assert.rejects(service.call('saveSettings',{settings:{speechRate:'fast'}},u));
  await assert.rejects(service.call('saveSettings',{settings:{token:'x'}},u));
});
test('API keys never appear in state or the other user profile',async t=>{
  const {service,db}=setup();t.after(()=>db.close());const key='FAKE_GEMINI_KEY_FOR_REGRESSION';
  await service.call('configureTts',{key},u);const state=await service.call('getState',{},u);
  assert.equal(state.ttsConfigured,true);assert.equal(JSON.stringify(state).includes(key),false);assert.equal((await service.call('getState',{},other)).ttsConfigured,false);
});
test('caption, repeat update, edit, paused source and cross-source dedupe',async t=>{
  const sent=[];const {service,store,db}=setup({api:{sendMessage:async m=>sent.push(m),getMe:async()=>({username:'ExampleBot'})}});t.after(()=>db.close());
  await service.call('manageChannel',{action:'add',username:'example'},u);
  const m={message_id:10,chat:{id:-100123,username:'example',title:'Example'},caption:'Срочно важная подпись',date:1000};
  await service.channelPost(m);await service.channelPost(m);assert.equal((await store.feed(1)).messages.length,1);assert.equal(sent.length,1);
  await service.channelPost({...m,caption:'Отредактировано'},true);assert.equal((await store.feed(1)).messages[0].text,'Отредактировано');assert.equal(sent.length,1);
  assert.equal(await store.savePost(1,{key:'public:example:10',username:'example',title:'Example',text:'same',date:1000}),false);
  await service.call('manageChannel',{action:'toggle',username:'example'},u);await service.channelPost({...m,message_id:11});assert.equal((await store.feed(1)).messages.length,1);
  assert.equal((await store.feed(2)).messages.length,0);
});
test('unsubscribed channel does not enter the feed',async t=>{
  const {service,store,db}=setup();t.after(()=>db.close());await service.channelPost({chat:{username:'other'},message_id:1,text:'leak',date:1});assert.equal((await store.feed(1)).messages.length,0);
});
test('blocked recipient cannot prevent other subscribers from receiving the post',async t=>{
  const sent=[];const {service,store,db}=setup({api:{sendMessage:async m=>{if(m.chat_id===1){const e=Error('blocked');e.code=403;throw e;}sent.push(m);},getMe:async()=>({username:'ExampleBot'})}});t.after(()=>db.close());
  for(const user of [u,other])await service.call('manageChannel',{action:'add',username:'example'},user);
  await assert.rejects(service.channelPost({message_id:9,chat:{username:'example'},text:'news',date:1000}),{code:'DELIVERY_FAILED'});
  assert.equal(sent.length,1);assert.equal(sent[0].chat_id,2);assert.equal((await store.get('SELECT notified FROM posts WHERE user_id=1')).notified,2);
});
test('public check uses a baseline, retains media cursor and only inserts new texts',async t=>{
  let page=html(10)+html(11,'old');const {service,store,db}=setup({fetcher:async()=>({ok:true,text:async()=>page})});t.after(()=>db.close());
  await service.call('manageChannel',{action:'add',username:'example'},u);
  assert.equal((await service.call('checkChannels',{},u)).newPostsCount,0);
  page+=html(12)+html(13,'new');assert.equal((await service.call('checkChannels',{},u)).newPostsCount,1);
  const feed=await store.feed(1);assert.equal(feed.messages.length,1);assert.equal(feed.messages[0].text,'new');
  assert.equal((await store.get('SELECT cursor FROM channels WHERE user_id=1')).cursor,13);
  await assert.rejects(service.call('checkChannels',{},u),{code:'RATE_LIMIT'});
});
test('failed public check does not advance cursor and exposes source error',async t=>{
  const {service,store,db}=setup({fetcher:async()=>({ok:false,status:502})});t.after(()=>db.close());await service.call('manageChannel',{action:'add',username:'example'},u);
  const result=await service.call('checkChannels',{},u);assert.match(result.trackedChannels[0].error,/502/);assert.equal((await store.get('SELECT cursor FROM channels')).cursor,0);
});
test('addressed bot commands work; commands for another bot are ignored',async t=>{
  const {service,db}=setup();t.after(()=>db.close());assert.ok((await service.command(1,'/list@ExampleBot')).includes('срочно'));assert.equal(await service.command(1,'/clear@OtherBot'),'');assert.ok((await service.command(1,'/list')).includes('срочно'));
});
test('long Gemini input reaches provider completely as chunks, not 800-character truncation',async t=>{
  const received=[];const {service,db}=setup({fetcher:async(_url,request)=>{received.push(JSON.parse(request.body).contents[0].parts[0].text);return{ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{data:'UklGRg==',mimeType:'audio/wav'}}]}}]})};}});t.after(()=>db.close());await service.call('configureTts',{key:'FAKE_GEMINI_KEY_FOR_REGRESSION'},u);
  const text='длинный текст '.repeat(200);const result=await service.call('tts',{text},u);assert.equal(received.join(''),text.trim());assert.ok(result.chunks.length>1);
});
test('TTS provider error is sanitized; no fallback truncation or secret disclosure',async t=>{
  const {service,db}=setup({fetcher:async()=>({ok:false,status:429})});t.after(()=>db.close());await service.call('configureTts',{key:'FAKE_GEMINI_KEY_FOR_REGRESSION'},u);
  await assert.rejects(service.call('tts',{text:'hello'},u),e=>e.code==='RATE_LIMIT'&&!e.message.includes('FAKE_'));
});
test('test posts are idempotent with a request ID',async t=>{
  const {service,store,db}=setup();t.after(()=>db.close());for(let i=0;i<2;i++)await service.call('simulatePost',{text:'test',requestId:'same'},u);assert.equal((await store.feed(1)).messages.length,1);
});
