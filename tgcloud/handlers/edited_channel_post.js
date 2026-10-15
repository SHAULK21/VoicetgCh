import {service} from '../lib/cloud.js';
export default async function(message) {await service.channelPost(message,true);}
