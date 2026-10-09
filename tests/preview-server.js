'use strict';
// Local UI fixture only. Never imported by server.js or included in public build.
// No Firebase, maps, email, SMS, Cloudinary, or AI provider is contacted by APIs.
const express=require('express');
const fs=require('fs');
const path=require('path');
const {publicAssets}=require('../middleware/publicAssets');
const root=path.resolve(__dirname,'..');
const app=express();app.use(express.json());
app.get('/maps-disabled.js', (_req,res)=>res.type('js').send('// Maps intentionally disabled in the synthetic preview.'));
const user={uid:'preview-user',email:'preview@example.test',displayName:'Preview User',getIdToken:async()=> 'preview-only'};
app.get('/firebase-config.js',(_req,res)=>res.type('js').send(`export const auth={currentUser:{uid:'preview-user',email:'preview@example.test',getIdToken:async()=> 'preview-only'},authStateReady:async()=>{}};`));
app.get('/config.js',(_req,res)=>res.type('js').send(fs.readFileSync(path.join(root,'config.js'),'utf8')+`\nlocalStorage.setItem('hershield_logged_in','true');localStorage.setItem('hershield_backend_user_id','preview-user');localStorage.setItem('hershield_user_email','preview@example.test');localStorage.setItem('hershield_user_name','Preview User');sessionStorage.setItem('hs_admin_token','preview-only');window.authService={isLoggedIn:()=>true,getCurrentUser:()=>({uid:'preview-user',email:'preview@example.test',displayName:'Preview User'}),getUserDisplayName:()=> 'Preview User',getUserEmail:()=> 'preview@example.test'};`));
const contacts=[];
// Synthetic email fixture: UI tests only; never sends mail or marks a real account.
let emailVerified = false, emailSentAt = 0;
app.get('/api/email-verification/status', (_req, res) => res.json({ success: true, email: user.email, verified: emailVerified,
    retryAfter: Math.max(0, Math.ceil((emailSentAt + 60000 - Date.now()) / 1000)),
    expiresIn: emailSentAt ? Math.max(0, Math.ceil((emailSentAt + 300000 - Date.now()) / 1000)) : 0 }));
app.post('/api/email-verification/send', (_req, res) => {
    emailSentAt = Date.now(); res.json({ success: true, email: user.email, verified: emailVerified, retryAfter: 60, expiresIn: 300 });
});
app.post('/api/email-verification/verify', (req, res) => {
    if (req.body.code !== '123456' || !emailSentAt) return res.status(400).json({ success: false, message: 'That code is incorrect. Check your email and try again.' });
    emailVerified = true; res.json({ success: true, email: user.email, verified: true });
});
app.use('/api',(req,res)=>{
    if(req.path.includes('/contacts')&&req.method==='POST')contacts.push({_id:String(contacts.length+1),...req.body});
    res.json({success:true,user:{_id:user.uid,name:user.displayName,email:user.email,emergencyContacts:contacts},contacts,posts:[],alerts:[],incidents:[],points:[],locations:[],history:[],sessions:[],users:[],logs:[],verifications:[],reports:[],stats:{communityMembers:3,totalSosAlerts:0,safeTrips:0,safeZones:2},verificationStatus:'verified'});
});
app.get(/\.html$/, (req,res,next)=>{
    const name=path.basename(req.path);
    if(!require('../middleware/publicAssets').PUBLIC_FILES.has(name))return next();
    const html=fs.readFileSync(path.join(root,name),'utf8')
        .replace(/<script\b[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>/gi,'')
        .replace(/<script\b[^>]*src=["'][^"']*maps\.googleapis\.com[^"']*["'][^>]*>[\s\S]*?<\/script>/gi,'')
        .replace(/<script>import\('.\/firebase-auth\.js'\)[\s\S]*?<\/script>/g,'')
        .replace(/https:\/\/maps\.googleapis\.com\/[^'"\s<>]+/g, '/maps-disabled.js')
        .replace('<body','<body data-ui-fixture="true"');
    res.type('html').send(html);
});
app.use(publicAssets(root));
const port = Number(process.env.PREVIEW_PORT || 4173);
app.listen(port,'127.0.0.1',()=>console.log(`Synthetic UI preview: http://127.0.0.1:${port}/dashboard.html`));
