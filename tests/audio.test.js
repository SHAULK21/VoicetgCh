import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {DEFAULT_SETTINGS} from '../tgcloud/lib/domain.js';
function setup(voices=[{name:"Google українська",lang:"uk-UA"}],delayed=false) {
  const spoken=[],calls=[];let current;
  let voicesChanged;
  const speech={getVoices:()=>voices,speak:u=>{spoken.push(u);current=u;},cancel:()=>{current?.onerror?.({error:'canceled'});current=null;}};
  if(delayed){speech.addEventListener=(_event,listener)=>{voicesChanged=listener;};speech.removeEventListener=()=>{voicesChanged=null;};}
  const node=()=>({connect(){},disconnect(){},gain:{value:1}});
  class Context {state='running';destination={};async resume(){}createGain(){return node();}createAnalyser(){return node();}createDynamicsCompressor(){return node();}}
  const ctx=vm.createContext({window:{AudioContext:Context,speechSynthesis:speech},speechSynthesis:speech,SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},setTimeout,clearTimeout,console,call:async(action,input)=>{calls.push({action,input});throw Error('provider unavailable');}});
  let source=readFileSync(new URL('../src/services/audioEngine.ts',import.meta.url),'utf8').replace(/^import .+;\n/gm,'').replace(/export class /g,'class ').replace(/export function /g,'function ').replace(/export const audioEngine=new AudioEngine\(\);/,'globalThis.engine=new AudioEngine();');
  vm.runInContext(stripTypeScriptTypes(source),ctx);
  return {engine:ctx.engine,spoken,calls,loadVoices:()=>{voices.push({name:'Українська',lang:'uk-UA'});voicesChanged?.();},finish:()=>{current?.onend?.();current=null;}};
}
const post=(id,alert=false)=>({id,text:id,spokenText:id,channelTitle:'Test',channelUsername:'@test',date:1,timestamp:'',hasAlert:alert,matchedWords:[]});
const tick=()=>new Promise(setImmediate);
test('audio queue snapshots settings and urgent posts precede waiting normal posts',async()=>{
  const {engine,spoken,finish}=setup(),settings={...DEFAULT_SETTINGS,speechRate:1};
  engine.enqueueMessage(post('first'),settings);await tick();assert.equal(spoken[0].text,'first');
  engine.enqueueMessage(post('second'),settings);engine.enqueueMessage(post('urgent',true),settings);settings.speechRate=1.75;
  finish();await tick();assert.equal(spoken[1].text,'urgent');assert.ok(spoken[1].rate<1.5);
  finish();await tick();assert.equal(spoken[2].text,'second');assert.equal(spoken[2].rate,1);engine.stopCurrent();
});
test('stop cancels pending speech and clears queue; a later message can play',async()=>{
  const {engine,spoken}=setup();engine.enqueueMessage(post('first'),DEFAULT_SETTINGS);engine.enqueueMessage(post('should not play'),DEFAULT_SETTINGS);await tick();engine.stopCurrent();await tick();assert.equal(spoken.length,1);
  engine.enqueueMessage(post('new'),DEFAULT_SETTINGS);await tick();assert.equal(spoken.at(-1).text,'new');engine.stopCurrent();
});
test('Gemini preview uses explicit selected voice and reports fallback once',async()=>{
  const {engine,spoken,calls}=setup();const errors=[];engine.subscribeStatus(s=>{if(s.error)errors.push(s.error);});engine.enqueueMessage(post('preview'),{...DEFAULT_SETTINGS,engine:'gemini',voiceName:'Fenrir'});await tick();
  assert.equal(calls.length,1);assert.equal(calls[0].input.voiceName,'Fenrir');assert.equal(spoken.length,1);assert.match(errors[0],/системный голос/);engine.stopCurrent();
});

test('Ukrainian voice is used even when text has no distinct Ukrainian letters',async()=>{
  const {engine,spoken}=setup();engine.enqueueMessage(post('Новини'),DEFAULT_SETTINGS);await tick();assert.equal(spoken[0].lang,'uk-UA');assert.equal(spoken[0].voice.lang,'uk-UA');engine.stopCurrent();
});
test('missing Ukrainian voice reports error instead of using another language',async()=>{
  const {engine,spoken}=setup([{name:'English',lang:'en-US'}]),errors=[];engine.subscribeStatus(s=>{if(s.error)errors.push(s.error);});engine.enqueueMessage(post('Новини'),DEFAULT_SETTINGS);await tick();assert.equal(spoken.length,0);assert.ok(errors.some(e=>e.includes('украинский голос')));engine.stopCurrent();
});
test('voice list can arrive asynchronously on first playback',async()=>{
  const {engine,spoken,loadVoices}=setup([],true);engine.enqueueMessage(post('Новини'),DEFAULT_SETTINGS);await tick();assert.equal(spoken.length,0);loadVoices();await tick();assert.equal(spoken.length,1);assert.equal(spoken[0].lang,'uk-UA');engine.stopCurrent();
});
test('stop while voices are loading prevents stale playback',async()=>{
  const {engine,spoken,loadVoices}=setup([],true);engine.enqueueMessage(post('Новини'),DEFAULT_SETTINGS);await tick();engine.stopCurrent();loadVoices();await tick();assert.equal(spoken.length,0);
});
