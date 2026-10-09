'use strict';
const fs=require('fs'); const path=require('path');
const {PUBLIC_FILES}=require('../middleware/publicAssets');
const root=path.resolve(__dirname,'..'), output=path.join(root,'dist');
fs.mkdirSync(output,{recursive:true});
// Only remove known build-output files. Fail if an unexpected file is present.
for(const entry of fs.readdirSync(output)) { if(!PUBLIC_FILES.has(entry)) throw new Error('Unexpected file in dist: '+entry); }
for(const file of PUBLIC_FILES) fs.copyFileSync(path.join(root,file),path.join(output,file));
console.log('Built '+PUBLIC_FILES.size+' explicitly public assets.');
