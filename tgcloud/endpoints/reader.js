import {service, publicError} from '../lib/cloud.js';
export default async function(input,ctx) {
  try {return await service.call(input.action,input.payload??{},ctx.initData?.user);}
  catch(e) {throw publicError(e);}
}
