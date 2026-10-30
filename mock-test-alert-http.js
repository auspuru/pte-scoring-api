'use strict';
const {snapshot,readingRecords}=require('./mock-test-alert-sources');
const ID=/^[a-zA-Z0-9_-]{1,120}$/;
function capture({monitor,verifyToken,logger=console}){
  return(req,res,next)=>{
    const route=(req.originalUrl||req.url||'').split('?')[0];
    const match=route.match(/^\/api\/(speaking-mocks|writing-lab|full-mocks)\/attempts(?:\/([a-zA-Z0-9_-]{1,120})(?:\/.*)?)?$/);
    const sync=route.match(/^\/api\/sync\/([^/]+)$/);
    if(!match&&!sync)return next();
    res.once('finish',()=>{
      const service=monitor();if(!service)return;
      const uid=verifyToken(req.headers['x-session-token']||'');
      if(!uid||res.statusCode>=400&&res.statusCode<500)return;
      void(async()=>{
        if(sync){
          if(req.method!=='POST'||decodeURIComponent(sync[1]).toLowerCase()!==uid.toLowerCase())return;
          const health=service.health();if(!health.enabled||!health.activeSince)return;
          const seen=new Set();
          for(const a of readingRecords(req.body?.readingProgress)){
            const value=snapshot('reading',a);if(!value?.isMock||!ID.test(a.id||'')||seen.has(a.id))continue;seen.add(a.id);
            const recentSubmission=value.submitted&&Number.isFinite(value.finishedAt)&&value.finishedAt>=health.activeSince;
            if(res.statusCode>=500&&a!==req.body?.readingProgress?.session&&!recentSubmission)continue;
            if(res.statusCode<400&&(!value.mediaError&&(!recentSubmission||service.hasSubmission('reading',uid,a.id))))continue;
            if(res.statusCode>=500)await service.error('reading',uid,a.id,'sync','HTTP_'+res.statusCode,a.name);
            else await service.observeId('reading',uid,a.id);
          }
          return;
        }
        const id=match[2]||req.body?.id;if(!ID.test(id||''))return;
        const engines=match[1]==='writing-lab'?['writing','listening']:[match[1]==='full-mocks'?'full':'speaking'];
        const operation=/\/recording|\/segments/.test(route)?'recording':/\/end$|\/finish$/.test(route)?'submission':/\/draft$|\/answer$/.test(route)?'save':/\/score|\/assessment|\/overall-feedback/.test(route)?'assessment':/\/results$|\/report$/.test(route)?'results':'load';
        for(const engine of engines){
          let value;
          try{value=await service.observeId(engine,uid,id);}catch{
            if(res.statusCode>=500&&engines.length===1)await service.error(engine,uid,id,operation,'HTTP_'+res.statusCode);
            continue;
          }
          if(value?.isMock){if(res.statusCode>=500)await service.error(engine,uid,id,operation,'HTTP_'+res.statusCode,value.title);break;}
        }
      })().catch(()=>logger.warn('[mock-alerts] Request notification will be recovered by the monitor.'));
    });
    next();
  };
}
module.exports={capture};
