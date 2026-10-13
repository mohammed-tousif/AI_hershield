'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const express = require('express');
const vm = require('vm');
const fs = require('fs');
process.env.ADMIN_JWT_SECRET = 'test-only-admin-key-with-at-least-thirty-two-characters';
const users = new Map([['alice', { _id:'alice', email:'alice@example.test', name:'Alice', homeAddress:'private', emergencyContacts:[] }], ['bob', { _id:'bob', email:'bob@example.test', name:'Bob', emergencyContacts:[] }]]);
const live = new Map(), classic = new Map();
const clone = value => value == null ? value : structuredClone(value);
function mock(modulePath, exports) { require.cache[require.resolve(modulePath)] = { id:require.resolve(modulePath), filename:require.resolve(modulePath), loaded:true, exports }; }
mock('../config/firestoreAdmin', { getFirestoreAdmin:()=>({}) });
mock('firebase-admin', { apps:[{}], auth:()=>({ verifyIdToken:async(token, revoked)=>{
    assert.equal(revoked,true);
    if (!['alice','bob'].includes(token)) throw Error('Invalid/revoked token');
    return { uid:token, email:token+'@example.test', name:token };
} }) });
const repo = {
    usersFindById:async id=>clone(users.get(id)), usersFindByEmail:async email=>clone([...users.values()].find(u=>u.email===email)),
    usersSave:async user=>users.set(user._id,clone(user)), usersCreate:async user=>users.set(user._id,clone(user)),
    liveSessionCreate:async(session,id)=>live.set(id,{...clone(session),_id:id}),
    liveSessionGetByUserId:async id=>clone(live.get(id)),
    liveSessionFindByCode:async code=>clone([...live.values()].find(s=>s.trackingCode===code)),
    liveSessionSetVerified:async id=>{live.get(id).lastVerified=new Date();},
    liveSessionPushLocation:async(id,lat,lng,accuracy)=>live.get(id).locationLogs.push({lat,lng,accuracy,timestamp:new Date().toISOString()}),
    liveSessionStop:async id=>{live.get(id).isTrackingActive=false;},
    liveSessionsByEmail:async email=>clone([...live.values()].filter(s=>s.email===email)),
    trackingFindById:async id=>clone(classic.get(id)), trackingFindByCode:async code=>clone([...classic.values()].find(s=>s.trackingCode===code)),
    trackingCodeExists:async()=>false, trackingCreate:async s=>classic.set(s._id,clone(s)), trackingUpdate:async s=>classic.set(s._id,clone(s)),
    trackingFindByUserId:async id=>clone([...classic.values()].filter(s=>s.userId===id)),
    sosCreate:async()=>{}, sosFindByUserId:async()=>[{userId:'alice',pinHash:'secret-hash',pin:'1234',status:'active'}],
};
mock('../services/firestoreRepository',repo);
mock('../services/smsService',{}); mock('../services/whatsappService',{});
mock('../services/emailService',{isConfigured:()=>false,sendMail:async()=>{throw Error('External email forbidden in tests');}});
mock('../services/userNotifications',{sendWelcomeEmail:()=>{}});
mock('../services/cloudinaryService',{isConfigured:()=>false});
mock('../services/geocoding',{reverseGeocode:async()=>null});
const {apiAccess}=require('../middleware/apiAccess');
const {publicAssets,PUBLIC_FILES}=require('../middleware/publicAssets');
const security=require('../services/trackingSecurity');
let server,base;
const emits=[];
const fakeIo={to:room=>({emit:(event,payload)=>emits.push({room,event,payload})}),in:()=>({socketsLeave(){}})};
before(async()=>{
    const app=express(); app.set('io',fakeIo); app.use(express.json()); app.use(publicAssets(path.resolve(__dirname,'..')));
    app.use('/api',apiAccess);
    app.use('/api/users',require('../routes/users'));
    app.use('/api/live-tracker',require('../routes/liveTracker'));
    app.use('/api/tracking',require('../routes/trackingLite'));
    app.use('/api/emergency',require('../routes/emergencyLite'));
    app.get('/api/community/posts',(_req,res)=>res.json({posts:[{userEmail:'private@example.test',likedBy:['private'],content:'public',pin:'secret'}]}));
    app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
    server=http.createServer(app); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
async function request(url, {user,method='GET',body}={}) {
    const response=await fetch(base+url,{method,headers:{...(user?{Authorization:'Bearer '+user}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
    return {status:response.status,data};
}
test('Only explicitly public assets are served; keys, source, data and encodings are blocked',async()=>{
    for(const file of ['hershield-firebase-adminsdk.json','.env','server.js','routes/users.js','data/users.db','PROJECT_AUDIT_INVENTORY.json','%68ershield-firebase-adminsdk.json']) {
        const r=await request('/'+file,{method:'HEAD'});assert.equal(r.status,404,file);
    }
    assert.equal((await request('/')).status,200);
    for(const file of PUBLIC_FILES) assert.equal((await request('/'+encodeURI(file),{method:'HEAD'})).status,200,file);
});
test('Anonymous, invalid and revoked sessions cannot read or write private data',async()=>{
    for(const user of [undefined,'invalid']) for(const [url,method,body] of [
        ['/api/users/profile/alice','GET'],['/api/users/profile/alice','PUT',{name:'Intruder'}],
        ['/api/emergency/contacts/alice','GET'],['/api/emergency/sos/history/alice','GET'],
        ['/api/live-tracker/history/alice@example.test','GET'],['/api/tracking/start','POST',{userId:'alice'}]
    ]) assert.equal((await request(url,{user,method,body})).status,401,url);
});
test('A valid account cannot read or edit a different account or forge signup identity',async()=>{
    assert.equal((await request('/api/users/profile/bob',{user:'alice'})).status,403);
    assert.equal((await request('/api/users/profile/bob',{user:'alice',method:'PUT',body:{name:'Intruder'}})).status,403);
    assert.equal((await request('/api/emergency/contacts/bob',{user:'alice'})).status,403);
    assert.equal((await request('/api/users/upsert',{user:'alice',method:'POST',body:{firebaseUid:'bob',email:'bob@example.test'}})).status,403);
    assert.equal((await request('/api/users/email/bob@example.test',{user:'alice'})).status,403);
    assert.equal((await request('/api/users/profile/alice',{user:'alice'})).status,200);
    assert.equal(users.get('bob').name,'Bob');
});
test('PINs are salted, legacy encodings are rejected and share capabilities are unpredictable',async()=>{
    const a=await security.hashPin('123456'),b=await security.hashPin('123456');
    assert.notEqual(a,b);assert.equal(await security.verifyPin('123456',a),true);
    assert.equal(await security.verifyPin('999999',a),false);
    assert.equal(await security.verifyPin('123456','123456'),false);
    assert.equal(new Set(Array.from({length:100},()=>security.newShareCode())).size,100);
});
test('Live journey ownership, hashed PIN, public minimal viewer, accuracy and revocation',async()=>{
    assert.equal((await request('/api/live-tracker/start',{user:'alice',method:'POST',body:{name:'Alice',pin:'abcd',emergencyContacts:[]}})).status,400);
    const start=await request('/api/live-tracker/start',{user:'alice',method:'POST',body:{name:'Alice',pin:'123456',email:'spoof@example.test',emergencyContacts:[],startLat:15,startLng:75}});
    assert.equal(start.status,201);const id=start.data.sessionId,s=live.get(id),code=s.trackingCode;
    assert.equal(s.ownerUid,'alice');assert.equal(s.email,'alice@example.test');assert.equal(s.pin,undefined);assert.match(s.pinHash,/^\$2/);assert.match(code,/^[A-F0-9]{64}$/);
    assert.equal((await request('/api/live-tracker/update-location',{user:'bob',method:'POST',body:{userId:id,lat:1,lng:1}})).status,403);
    assert.equal((await request('/api/live-tracker/update-location',{user:'alice',method:'POST',body:{userId:id,lat:15,lng:75,accuracy:450}})).status,200);
    const view=await request('/api/live-tracker/view/'+code);assert.equal(view.status,200);assert.equal(view.data.accuracy,450);assert.equal(view.data.email,undefined);assert.equal(view.data.pinHash,undefined);
    assert.equal((await request('/api/live-tracker/location/'+id)).status,401);
    assert.equal((await request('/api/live-tracker/verify-pin',{user:'alice',method:'POST',body:{userId:id,pin:'999999'}})).status,401);
    assert.equal((await request('/api/live-tracker/verify-pin',{user:'alice',method:'POST',body:{userId:id,pin:'123456'}})).status,200);
    assert.equal((await request('/api/live-tracker/stop',{user:'alice',method:'POST',body:{userId:id,pin:'123456'}})).status,200);
    assert.equal((await request('/api/live-tracker/view/'+code)).status,410);
    assert.equal((await request('/api/live-tracker/verify-pin',{user:'alice',method:'POST',body:{userId:id,pin:'123456'}})).status,409);
    assert.equal((await request('/api/live-tracker/trigger-alert',{user:'alice',method:'POST',body:{userId:id}})).status,409);
});
test('Classic sharing uses the same minimal viewer and expires; ownership is enforced',async()=>{
    const code=security.newShareCode();classic.set('classic',{_id:'classic',userId:'alice',trackingCode:code,status:'active',shareExpiresAt:security.shareExpiresAt(),currentLocation:{latitude:1,longitude:2}});
    assert.equal((await request('/api/tracking/session/classic',{user:'bob'})).status,403);
    assert.equal((await request('/api/tracking/code/'+code,{user:'bob'})).status,403);
    assert.equal((await request('/api/live-tracker/view/'+code)).data.lat,1);
    classic.get('classic').shareExpiresAt=new Date(0).toISOString();assert.equal((await request('/api/live-tracker/view/'+code)).status,410);
});
test('PIN hashes and public reporter/like identities never leave JSON responses',async()=>{
    const history=await request('/api/emergency/sos/history/alice',{user:'alice'});assert.equal(history.status,200);assert.equal(history.data.history[0].pinHash,undefined);
    const posts=await request('/api/community/posts');assert.deepEqual(posts.data.posts,[{content:'public'}]);
});
test('A PIN confirmation network failure preserves the safety timeout and shows an error',async()=>{
    const source=fs.readFileSync(path.join(__dirname,'../live-tracker.js'),'utf8');const start=source.indexOf('async handleVerifyPin()');const end=source.indexOf('    // ── Emergency trigger',start);
    const error={style:{},textContent:''};let cleared=false,confirmed=false;
    const ctx={document:{getElementById:id=>id==='safetyCodeInput'?{value:'123456'}:error},fetch:async()=>{throw Error('offline');},clearTimeout:()=>cleared=true};
    const method=vm.runInNewContext('({'+source.slice(start,end)+'})',ctx).handleVerifyPin;
    await method.call({sessionId:'test',showToast:()=>confirmed=true,resetVerificationTimer:()=>confirmed=true});
    assert.equal(cleared,false);assert.equal(confirmed,false);assert.match(error.textContent,/timer is still running/);
});
test('Guardians get each fix in real time with server time; sender state is owner-only; expired shares refuse updates',async()=>{
    const start=await request('/api/live-tracker/start',{user:'alice',method:'POST',body:{name:'Alice',pin:'123456',emergencyContacts:[]}});
    const id=start.data.sessionId,code=live.get(id).trackingCode;
    emits.length=0;
    assert.equal((await request('/api/live-tracker/update-location',{user:'alice',method:'POST',body:{userId:id,lat:15.5,lng:75.5,accuracy:12,fixAgeMs:4000}})).status,200);
    const pushed=emits.find(e=>e.event==='locationUpdated');
    assert.equal(pushed.room,'tracking:'+id);
    assert.equal(pushed.payload.lat,15.5);assert.equal(pushed.payload.accuracy,12);
    const age=Date.parse(pushed.payload.serverTime)-Date.parse(pushed.payload.timestamp);
    assert.ok(age>=4000&&age<6000,'the timestamp reflects when the fix was taken, not when it arrived');
    assert.equal(pushed.payload.email,undefined);assert.equal(pushed.payload.pinHash,undefined);
    const view=await request('/api/live-tracker/view/'+code);
    assert.equal(view.data.lat,15.5);assert.ok(Date.parse(view.data.serverTime));
    assert.equal((await request('/api/live-tracker/sender-state',{user:'bob',method:'POST',body:{userId:id,state:'background'}})).status,403);
    assert.equal((await request('/api/live-tracker/sender-state',{user:'alice',method:'POST',body:{userId:id,state:'background'}})).status,200);
    assert.equal(emits.find(e=>e.event==='senderState').payload.senderState,'background','same field the viewer reads from /view and locationUpdated');
    assert.equal((await request('/api/live-tracker/view/'+code)).data.senderState,'background');
    live.get(id).shareExpiresAt=new Date(Date.now()-1000).toISOString();
    const expired=await request('/api/live-tracker/update-location',{user:'alice',method:'POST',body:{userId:id,lat:15.6,lng:75.6,accuracy:12}});
    assert.equal(expired.status,410);assert.equal(expired.data.ended,true);
});
test('Socket clients cannot register mutation handlers or join with a raw session ID',async()=>{
    const {installSocketAccess}=require('../services/socketAccess');let connection;
    installSocketAccess({on:(name,fn)=>{connection=fn;}});
    const handlers={},joined=[];connection({on:(name,fn)=>handlers[name]=fn,join:async room=>joined.push(room),leave:async()=>{},emit:()=>{}});
    for(const event of ['locationUpdate','emergency','checkIn','endSession'])assert.equal(handlers[event],undefined);
    await handlers.joinSession('classic',()=>{});assert.equal(joined.length,0);handlers.disconnect();
});
