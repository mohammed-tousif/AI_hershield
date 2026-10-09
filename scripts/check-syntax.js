'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const {PUBLIC_FILES}=require('../middleware/publicAssets');
let checked=0;
function check(source,name) {
    const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:source,encoding:'utf8'});
    if(result.status!==0)throw Error(name+'\n'+(result.stderr || result.error));
    checked++;
}
for(const file of PUBLIC_FILES) {
    const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    if(file.endsWith('.js'))check(source,file);
    if(file.endsWith('.html'))for(const [index,match] of [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].entries()) {
        if(/\bsrc\s*=/.test(match[1]) || /application\/ld\+json/.test(match[1]))continue;
        check(match[2],file+' inline script '+index);
    }
}
for(const folder of ['routes','services','middleware','config','scripts'])for(const file of fs.readdirSync(path.join(__dirname,'..',folder))) {
    if(file.endsWith('.js'))check(fs.readFileSync(path.join(__dirname,'..',folder,file),'utf8'),folder+'/'+file);
}
check(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),'server.js');
console.log(`Syntax verified: ${checked} JavaScript files and inline scripts.`);
