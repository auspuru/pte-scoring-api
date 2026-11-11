'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
async function fixture(t,{canSpeak=true,progressive=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'random-practice-')),app=express();app.use(express.json());let modelCalls=0;
  const verifyToken=token=>['alice','bob'].includes(token)?token:null,getAccount=async id=>['alice','bob'].includes(id)?{username:id}:null;
  const speaking=require('../../speaking-mock').installSpeakingMock(app,{directory:path.join(directory,'speaking'),verifyToken,getAccount,backgroundEnabled:progressive,azureAvailable:false,azureOverallAvailable:false});
  const writing=require('../../writing-lab').installWritingLab(app,{directory:path.join(directory,'writing'),verifyToken,getAccount,speakingAllowed:async()=>canSpeak,callModel:async()=>{modelCalls++;throw Error('No provider calls in this fixture.');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await speaking.stop();await speaking.waitForJobs();await writing.stop();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  async function request(route,body,token='alice'){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(token?{'x-session-token':token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  return{app,base,request,speaking,writing,modelCalls:()=>modelCalls};
}
module.exports={fixture};
