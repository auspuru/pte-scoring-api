'use strict';
const claudeFormat=require('./essay-judge-format');
const openaiFormat=require('./essay-openai-format');

function configuration(env=process.env) {
  const provider=String(env.ESSAY_SCORING_PROVIDER || 'anthropic').trim().toLowerCase();
  if(!['anthropic','openai'].includes(provider))throw Object.assign(new Error('Unsupported essay scoring provider'),{code:'ESSAY_PROVIDER_CONFIG',retryable:false});
  return {provider,model:provider==='openai'?openaiFormat.model(env):claudeFormat.essayModel(env)};
}

function createEssayProvider({anthropic,apiKey=process.env.OPENAI_API_KEY,fetch:request=fetch,env=process.env}={}) {
  const config=configuration(env);
  const call=async (prompt,options={})=>{
    if(config.provider==='anthropic') {
      if(!anthropic)throw Object.assign(new Error('Essay grader unavailable'),{code:'ESSAY_PROVIDER_UNAVAILABLE',retryable:false});
      const result=await anthropic.messages.create(claudeFormat.request(prompt,config.model,options),
        {timeout:options.timeoutMs || 85000,maxRetries:0,...(options.signal?{signal:options.signal}:{})});
      return {...claudeFormat.response(result,options),scoringProvider:'anthropic',scoringModel:claudeFormat.modelFor(config.model,options,env.CLAUDE_REASSESSMENT_MODEL || 'claude-sonnet-4-6')};
    }
    if(!apiKey)throw Object.assign(new Error('Essay grader unavailable'),{code:'ESSAY_PROVIDER_UNAVAILABLE',retryable:false});
    const timeout=AbortSignal.timeout(options.timeoutMs || 85000);
    const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
    const result=await request('https://api.openai.com/v1/responses',{method:'POST',
      headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
      body:JSON.stringify(openaiFormat.request(prompt,options,env)),signal});
    if(!result.ok) {
      // Provider error bodies may echo credentials or input. Never publish or
      // log them, and never switch providers silently after a failed request.
      await result.body?.cancel();
      throw Object.assign(new Error('OpenAI essay assessment request failed'),{
        code:'ESSAY_PROVIDER_HTTP',status:result.status,retryable:![400,401,403,404].includes(result.status)});
    }
    return {...openaiFormat.response(await result.json(),options),scoringProvider:'openai',scoringModel:openaiFormat.model(env)};
  };
  call.configuration=Object.freeze({...config});
  return call;
}
module.exports={configuration,createEssayProvider};
