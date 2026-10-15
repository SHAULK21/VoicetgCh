import express from 'express';
import 'dotenv/config';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {openDatabase} from './local/database.js';
import {verifyInitData,secureEqual} from './local/auth.js';
import {createStorage} from './tgcloud/lib/storage.js';
import {createService} from './tgcloud/lib/service.js';
import {AppError,requireUser} from './tgcloud/lib/domain.js';
export async function createApp(options={}) {
  const app=express(), production=options.production??process.env.NODE_ENV==='production';
  const token=options.token??process.env.BOT_TOKEN;
  const webhookSecret=options.webhookSecret??process.env.WEBHOOK_SECRET;
  if(production&&(!token||!webhookSecret||webhookSecret.length<32)) throw new Error('Production requires BOT_TOKEN and WEBHOOK_SECRET (32+ chars).');
  const db=options.db??openDatabase(process.env.DATA_PATH??resolve('data/reader.sqlite'));
  const store=createStorage(db);
  const fetcher=options.fetcher??((url,init={})=>fetch(url,{...init,signal:AbortSignal.timeout(25000)}));
  const api=options.api??(token?new Proxy({}, {get:(_,method)=>async params=>{
    const res=await fetcher(`https://api.telegram.org/bot${token}/${String(method)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params??{})});
    const body=await res.json();if(!body.ok) {const err=new Error('Telegram rejected request');err.code=body.error_code;throw err;}return body.result;
  }}):undefined);
  const service=createService(store,{api,fetcher,defaultKey:options.defaultKey??process.env.GEMINI_API_KEY,botUsername:options.botUsername??process.env.BOT_USERNAME??''});
  app.disable('x-powered-by');
  app.use(express.json({limit:'64kb'}));
  app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');next();});
  app.get('/api/health',(_req,res)=>res.json({ok:true}));
  app.post('/api/bot/webhook',async(req,res,next)=>{
    try {
      if(!webhookSecret||!secureEqual(req.get('X-Telegram-Bot-Api-Secret-Token'),webhookSecret)) throw new AppError('Нет доступа.','UNAUTHORIZED');
      const u=req.body;
      if(u.channel_post) await service.channelPost(u.channel_post);
      else if(u.edited_channel_post) await service.channelPost(u.edited_channel_post,true);
      else if(u.message?.chat?.type==='private'&&u.message.text?.startsWith('/')&&!u.message.from?.is_bot) {
        const uid=requireUser(u.message.from),key=`${uid}:${u.update_id??u.message.message_id}`;
        const claim=await store.run('INSERT INTO command_updates(request_key,created_at) VALUES(:k,:t) ON CONFLICT(request_key) DO NOTHING',{':k':key,':t':Date.now()});
        if(claim.rowsAffected) {let reply;try{reply=await service.command(uid,u.message.text);}catch(e){reply=e instanceof AppError?e.message:'Ошибка выполнения команды.';}if(reply&&api) await api.sendMessage({chat_id:uid,text:reply});}
      }
      res.json({ok:true});
    }catch(e){next(e);}
  });
  app.post('/api/reader',async(req,res,next)=>{
    try {
      if(req.get('Sec-Fetch-Site')==='cross-site') throw new AppError('Нет доступа.','UNAUTHORIZED');
      const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      const allowLocal=options.allowLocal??process.env.ALLOW_LOCAL_DEV==='true';
      const user=!production&&allowLocal&&local?{id:1}:verifyInitData(req.get('X-Telegram-Init-Data'),token);
      const result=await service.call(req.body.action,req.body.payload??{},user);
      res.json({ok:true,result});
    }catch(e){next(e);}
  });
  app.use('/api',(_req,res)=>res.status(404).json({ok:false,description:'Маршрут не найден.'}));
  app.use((error,_req,res,_next)=>{
    const known=error instanceof AppError;
    const status=known?({UNAUTHORIZED:401,NOT_FOUND:404,CONFLICT:409,RATE_LIMIT:429}[error.code]??400):error.type==='entity.too.large'?413:500;
    if(!known) console.error('Request failed:',error.type??error.name);
    res.status(status).json({ok:false,description:known?error.message:'Не удалось выполнить запрос.',code:known?error.code:'INTERNAL'});
  });
  if(!production&&!options.noFrontend) {const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);app.locals.vite=vite;}
  else if(!options.noFrontend) {app.use(express.static(resolve(dirname(fileURLToPath(import.meta.url)),'dist')));app.get('*',(_req,res)=>res.sendFile(resolve('dist/index.html')));}
  return {app,db,service,store};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {app,db}=await createApp();
  const server=app.listen(Number(process.env.PORT??3000),process.env.HOST??'127.0.0.1',()=>console.log('Voice Reader listening on port',process.env.PORT??3000));
  const stop=()=>server.close(async()=>{await app.locals.vite?.close();db.close();process.exit(0);});
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
