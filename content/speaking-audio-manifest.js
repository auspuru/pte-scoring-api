'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=function(){let added={};try{added=JSON.parse(fs.readFileSync(path.join(__dirname,'speaking-audio/user-manifest.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}return {...require('./speaking-audio/manifest.json'),...added};};
