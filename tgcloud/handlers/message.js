import {api, db} from 'sdk';
import {service} from '../lib/cloud.js';
import {AppError, requireUser} from '../lib/domain.js';
export default async function(message,ctx) {
  if(message.chat?.type!=='private'||!message.text?.startsWith('/')||message.from?.is_bot) return;
  const uid=requireUser(message.from);
  const key=`${uid}:${ctx.update?.update_id??message.message_id}`;
  const claim=await db.run('INSERT INTO command_updates(request_key,created_at) VALUES(:k,:t) ON CONFLICT(request_key) DO NOTHING',{':k':key,':t':Date.now()});
  if(!claim.rowsAffected) return;
  let reply;
  try {reply=await service.command(uid,message.text);}
  catch(e) {reply=e instanceof AppError?e.message:'Не удалось выполнить команду. Попробуйте позже.';}
  if(reply) await api.sendMessage({chat_id:message.chat.id,text:reply});
  await db.run('DELETE FROM command_updates WHERE created_at<:t',{':t':Date.now()-7*86400000});
}
