'use strict';
// The child server cannot reach a mail service; only an isolated test outbox.
const fs=require('node:fs'),path=require('node:path'),directory=process.env.AUTH_TEST_DIRECTORY;
if(process.env.NODE_ENV!=='test'||!directory||!path.basename(directory).startsWith('pte-auth-test-'))throw Error('Mail sink requires an isolated auth test directory.');
require('nodemailer').createTransport=()=>({sendMail:async message=>{fs.writeFileSync(path.join(directory,'mail.json'),JSON.stringify(message));return{messageId:'fixture-only'};}});
const nativeNow=Date.now;Date.now=()=>{let offset=0;try{offset=JSON.parse(fs.readFileSync(path.join(directory,'clock.json'),'utf8'));}catch{}return nativeNow()+offset;};

const narration=require('../../writing-lab-audio'),install=narration.installNarration;
narration.installNarration=(app,directory)=>install(app,directory,{prewarm:false});
