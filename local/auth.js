import {createHmac,timingSafeEqual} from 'node:crypto';
import {AppError,requireUser} from '../tgcloud/lib/domain.js';
export function secureEqual(a,b) {
  if(typeof a!=='string'||typeof b!=='string') return false;
  const aa=Buffer.from(a),bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}
export function verifyInitData(raw, token, now=Date.now()) {
  if(typeof raw!=='string'||!token) throw new AppError('Откройте панель из Telegram.','UNAUTHORIZED');
  const values=new URLSearchParams(raw),hash=values.get('hash');
  if([...values.keys()].length!==new Set(values.keys()).size) throw new AppError('Некорректная авторизация.','UNAUTHORIZED');
  values.delete('hash');
  const check=[...values.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  const expected=createHmac('sha256',secret).update(check).digest('hex');
  const time=Number(values.get('auth_date'))*1000;
  if(!secureEqual(hash,expected)||!Number.isFinite(time)||now-time>3600000||time>now+30000) throw new AppError('Авторизация истекла. Откройте панель заново.','UNAUTHORIZED');
  let user;try {user=JSON.parse(values.get('user'));} catch {throw new AppError('Некорректная авторизация.','UNAUTHORIZED');}
  requireUser(user);return user;
}
