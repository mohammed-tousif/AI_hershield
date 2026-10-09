'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../config.js'), 'utf8');
function client(fetch, deadline = 1000) {
    const window = {fetch, addEventListener() {}, dispatchEvent() {}};
    const notices=[];
    vm.runInNewContext(source, {window, location:{hostname:'localhost',origin:'http://localhost',href:'http://localhost/dashboard.html'},
        document:{body:null,querySelector:()=>null}, Request,Response,Headers,URL,AbortController,AbortSignal,DOMException,FormData,Event,
        setTimeout:(fn,ms)=>setTimeout(fn, ms >= 15000 ? deadline : ms),clearTimeout});
    window.hsConnectionNotice=message=>notices.push(message);
    window.getHerShieldToken=async()=> 'synthetic-token';
    return {window,notices};
}
test('Public reads share in-flight work, cache briefly and invalidate on writes',async()=>{
    let calls=0;
    const {window}=client(async()=>{calls++;await new Promise(r=>setTimeout(r,5));return Response.json({value:calls});});
    const [a,b]=await Promise.all([window.fetch('/api/dashboard/stats'),window.fetch('/api/dashboard/stats')]);
    assert.deepEqual(await a.json(),await b.json()); assert.equal(calls,1);
    await window.fetch('/api/dashboard/stats');assert.equal(calls,1);
    await window.fetch('/api/users/upsert',{method:'POST',body:'{}'});
    await window.fetch('/api/dashboard/stats');assert.equal(calls,3);
});
test('Only private first-party API requests receive Firebase credentials',async()=>{
    const observed=[];
    const {window}=client(async(input,options)=>{observed.push({input,options});return Response.json({success:true});});
    await window.fetch('/api/users/profile/alice');
    await window.fetch('/api/health');
    await window.fetch('https://other.example/api/users/profile/alice');
    assert.equal(observed[0].options.headers.get('Authorization'),'Bearer synthetic-token');
    assert.equal(observed[1].options.headers.has('Authorization'),false);
    assert.equal(observed[2].options,undefined);
});
test('A stalled download expires through the response body and releases the request',async()=>{
    const {window,notices}=client(async(_input,options)=>({status:200,statusText:'OK',headers:new Headers(),ok:true,
        arrayBuffer:()=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))}),25);
    await assert.rejects(window.fetch('/api/health'),/Unable to load/);
    assert.equal(notices.length,1);
});
test('Failed writes are never replayed and do not falsely claim success',async()=>{
    let calls=0;const {window,notices}=client(async()=>{calls++;throw Error('network lost');});
    await assert.rejects(window.fetch('/api/emergency/sos/start',{method:'POST',body:'{}'}),/did not confirm/);
    assert.equal(calls,1);assert.match(notices[0],/avoid sending it twice/);
});
test('Caller cancellation is respected even if an equivalent public read is cached',async()=>{
    let calls=0;const {window}=client(async(_input,options)=>{calls++;if(options.signal.aborted)throw options.signal.reason;return Response.json({});});
    await window.fetch('/api/health');
    const controller=new AbortController();controller.abort();
    await assert.rejects(window.fetch(new Request('http://localhost/api/health',{signal:controller.signal})));
    assert.equal(calls,2);
});
test('Slow authentication also has a deadline before sending a private request',async()=>{
    let calls=0;const {window}=client(async()=>{calls++;return Response.json({});},25);
    window.getHerShieldToken=()=>new Promise(()=>{});
    await assert.rejects(window.fetch('/api/users/profile/alice'),/Unable to load/);
    assert.equal(calls,0);
});
