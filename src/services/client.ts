declare global {
  interface Window { Telegram?: {WebApp?: {initData?:string;ready?:()=>void;expand?:()=>void;Serverless?:{call:(name:string,input:object,callback:(error:any,result:any)=>void)=>void}}} }
}
export async function call<T=any>(action:string,payload:object={}):Promise<T> {
  const app=window.Telegram?.WebApp;
  if(app?.Serverless && app.initData) return new Promise((resolve,reject)=>app.Serverless!.call('reader',{action,payload},(e,r)=>e?reject(new Error(e.message)):resolve(r)));
  const res=await fetch('/api/reader',{method:'POST',headers:{'Content-Type':'application/json',...(app?.initData?{'X-Telegram-Init-Data':app.initData}:{})},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(90000)});
  const data=await res.json();
  if(!res.ok||!data.ok) throw new Error(data.description||'Не удалось выполнить запрос.');
  return data.result;
}
