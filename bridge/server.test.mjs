import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createRelay } from './relay.mjs';
const tokens={room:'a'.repeat(16),publisherToken:'b'.repeat(48),viewerToken:'c'.repeat(48)};
const packet=(seq=1)=>({v:1,type:'hands',source:'glasses-camera',streamId:'test-stream-123',seq,capturedAtMs:Date.now(),width:640,height:480,coordinateSpace:'image-top-left',mirrored:false,hands:[]});
const receive=async ws=>JSON.parse((await once(ws,'message'))[0].toString());
async function setup(t) {
 const relay=createRelay(tokens);relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');
 t.after(()=>relay.close());
 const url=`ws://127.0.0.1:${relay.server.address().port}/ws`;
 const connect=async(role,token)=>{const ws=new WebSocket(url);await once(ws,'open');const ready=receive(ws);ws.send(JSON.stringify({type:'hello',role,room:tokens.room,token}));await ready;return ws;};
 return {relay,url,connect};
}
test('camera producer → paired browser; no frame replay on join; disconnect clears camera',async t=>{
 const {connect}=await setup(t);
 const producer=await connect('publisher',tokens.publisherToken);
 const viewer=await connect('viewer',tokens.viewerToken);
 const message=receive(viewer);const data=packet();producer.send(JSON.stringify(data));assert.deepEqual(await message,data);
 const lost=receive(viewer);producer.close();assert.deepEqual(await lost,{type:'camera',connected:false});
});
test('viewer credentials cannot publish',async t=>{
 const {connect}=await setup(t);const viewer=await connect('viewer',tokens.viewerToken);
 const closed=once(viewer,'close');viewer.send(JSON.stringify(packet()));assert.equal((await closed)[0],1008);
});
test('rejects incorrect and multibyte auth safely',async t=>{
 const {url}=await setup(t);
 for(const token of ['x'.repeat(48),'é'.repeat(48)]) {
  const ws=new WebSocket(url);await once(ws,'open');const closed=once(ws,'close');ws.send(JSON.stringify({type:'hello',role:'publisher',room:tokens.room,token}));assert.equal((await closed)[0],1008);
 }
});
test('invalid source and stale packets are discarded before a valid next frame',async t=>{
 const {connect}=await setup(t);const producer=await connect('publisher',tokens.publisherToken);const viewer=await connect('viewer',tokens.viewerToken);
 const result=receive(viewer);
 producer.send(JSON.stringify({...packet(1),source:'phone-camera'}));
 producer.send(JSON.stringify({...packet(2),capturedAtMs:Date.now()-10000}));
 const valid=packet(3);producer.send(JSON.stringify(valid));assert.deepEqual(await result,valid);
});

test('preview is opt-in per viewer; glasses get only landmarks; closing monitor stops demand', async t => {
 const {connect}=await setup(t);
 const producer=await connect('publisher',tokens.publisherToken);
 const glasses=await connect('viewer',tokens.viewerToken);
 const desktop=await connect('viewer',tokens.viewerToken);
 const demand=receive(producer);desktop.send(JSON.stringify({type:'preview',enabled:true}));
 assert.deepEqual(await demand,{type:'preview-demand',enabled:true});
 const frame={...packet(),preview:{mime:'image/jpeg',width:320,height:240,jpeg:'/9j/AAAA'}};
 const onGlasses=receive(glasses),onDesktop=receive(desktop);
 producer.send(JSON.stringify(frame));
 const {preview,...points}=frame;
 assert.deepEqual(await onGlasses,points);assert.deepEqual(await onDesktop,frame);
 const off=receive(producer);desktop.close();assert.deepEqual(await off,{type:'preview-demand',enabled:false});
});

test('oversized or malformed previews cannot get forwarded as hand frames', async t => {
 const {connect}=await setup(t);const producer=await connect('publisher',tokens.publisherToken);const viewer=await connect('viewer',tokens.viewerToken);
 const result=receive(viewer);
 producer.send(JSON.stringify({...packet(1),preview:{mime:'image/jpeg',width:320,height:240,jpeg:'/9j/'+ 'A'.repeat(65536)}}));
 producer.send(JSON.stringify({...packet(2),preview:{mime:'text/html',width:320,height:240,jpeg:'/9j/AAAA'}}));
 const valid=packet(3);producer.send(JSON.stringify(valid));assert.deepEqual(await result,valid);
});
