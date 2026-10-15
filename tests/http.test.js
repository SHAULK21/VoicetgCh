import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createApp} from '../server.js';
import {openDatabase} from '../local/database.js';
import {verifyInitData} from '../local/auth.js';
const token='123456:FAKE_BOT_TOKEN',secret='a'.repeat(40);
function signed(uid=1,time=Math.floor(Date.now()/1000)) {
  const values=new URLSearchParams({auth_date:String(time),user:JSON.stringify({id:uid,first_name:'Test'})});
  const check=[...values.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const key=createHmac('sha256','WebAppData').update(token).digest();values.set('hash',createHmac('sha256',key).update(check).digest('hex'));return values.toString();
}
test('initData signature, timestamp and duplicate fields are checked',()=>{
  assert.equal(verifyInitData(signed(),token).id,1);assert.throws(()=>verifyInitData(signed(1,1),token));assert.throws(()=>verifyInitData(signed()+'&user={"id":2}',token));assert.throws(()=>verifyInitData(signed().replace('Test','Fake'),token));
});
test('HTTP denies unauthorized mutation, webhook spoofing and old token endpoints',async t=>{
  const {app,db}=await createApp({noFrontend:true,production:true,token,webhookSecret:secret,db:openDatabase(':memory:'),api:{getMe:async()=>({username:'ExampleBot'}),sendMessage:async()=>({})}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.close(()=>{db.close();r();});}));
  const url=`http://127.0.0.1:${server.address().port}`;
  const post=(path,data,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  assert.equal((await post('/api/reader',{action:'filterWords',payload:{action:'clear'}})).status,401);
  assert.equal((await post('/api/bot/webhook',{message:{text:'/clear',chat:{id:1}}})).status,401);
  assert.equal((await fetch(url+'/api/events')).status,404);
  const state=await post('/api/reader',{action:'getState'},{'X-Telegram-Init-Data':signed()});assert.equal(state.status,200);assert.equal((await state.text()).includes(token),false);
  assert.equal((await post('/api/reader',{action:'getState'},{'X-Telegram-Init-Data':signed(),'Sec-Fetch-Site':'cross-site'})).status,401);
});
test('local dev bypass is disabled unless explicitly enabled; production never bypasses',async t=>{
  const {app,db}=await createApp({noFrontend:true,allowLocal:false,production:false,db:openDatabase(':memory:')});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(()=>{db.close();r();})));
  const result=await fetch(`http://127.0.0.1:${server.address().port}/api/reader`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'getState'})});assert.equal(result.status,401);
});
