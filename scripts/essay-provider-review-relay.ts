// Isolated, authenticated evaluation bridge. No student history, API-key
// disclosure, arbitrary upstream URL, hosted tools or request-body logging.
// Railway variables reference the owner's existing key; the source has none.
let calls=0;
const maximumCalls=80;
const models=new Set(['gpt-6.1-sol','gpt-6-astra']);
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
Bun.serve({port:Number(Bun.env.PORT || 8080),idleTimeout:120,async fetch(req:Request) {
  const url=new URL(req.url);
  if(req.method==='GET' && url.pathname==='/health')return json({ready:!!(Bun.env.OPENAI_API_KEY && Bun.env.ESSAY_REVIEW_TOKEN)});
  if(!Bun.env.ESSAY_REVIEW_TOKEN || req.headers.get('authorization')!=='Bearer '+Bun.env.ESSAY_REVIEW_TOKEN)return json({error:'Unauthorized'},401);
  if(req.method!=='POST' || url.pathname!=='/responses')return json({error:'Not found'},404);
  if(calls>=maximumCalls)return json({error:'Evaluation call limit reached'},429);
  if(Number(req.headers.get('content-length'))>220000)return json({error:'Request too large'},413);
  let body:any;
  try {const text=await req.text();if(text.length>220000)return json({error:'Request too large'},413);body=JSON.parse(text);}
  catch {return json({error:'Invalid request'},400);}
  if(!models.has(body.model) || !Array.isArray(body.input) || body.input.some((i:any)=>i.role!=='user' || typeof i.content!=='string')
    || !Number.isInteger(body.max_output_tokens) || body.max_output_tokens<1 || body.max_output_tokens>14000
    || body.tools?.some((t:any)=>t.type!=='function' || !/^submit_essay_[a-z_]+$/.test(t.name))
    || (body.reasoning?.effort && !['low','medium','high'].includes(body.reasoning.effort)))return json({error:'Invalid evaluation contract'},400);
  calls++;
  const started=Date.now();
  try {
    const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',
      headers:{Authorization:'Bearer '+Bun.env.OPENAI_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(85000),
      body:JSON.stringify({model:body.model,input:body.input,max_output_tokens:body.max_output_tokens,store:false,
        reasoning:body.reasoning,...(body.tools?{tools:body.tools,tool_choice:body.tool_choice,parallel_tool_calls:false}:{text:body.text})})});
    const data=await upstream.json();
    console.log(JSON.stringify({event:'essay-provider-review',model:body.model,status:upstream.status,durationMs:Date.now()-started}));
    if(!upstream.ok) {
      const code=String(data.error?.code || data.error?.type || 'provider_error').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
      return json({error:{code,...(code==='invalid_function_parameters'?{message:String(data.error?.message || '').slice(0,2000)}:{})}},upstream.status);
    }
    return json(data);
  } catch {return json({error:{code:'provider_unavailable'}},503);}
}});
