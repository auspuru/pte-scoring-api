'use strict';
const claudeFormat = require('./essay-judge-format');

function model(env=process.env) { return env.ESSAY_OPENAI_MODEL || 'gpt-6.1-sol'; }

function wireSchema(schema) {
  function visit(value) {
    if(Array.isArray(value))return value.map(visit);
    if(!value || typeof value!=='object')return value;
    // OpenAI strict tools disallow a description alongside $ref. Inline that
    // local definition while preserving the scoring contract and description.
    if(value.$ref && Object.keys(value).length>1) {
      const name=value.$ref.startsWith('#/$defs/')?value.$ref.slice(8):'';
      const target=schema.$defs?.[name];
      if(!target)throw invalid('ESSAY_PROVIDER_SCHEMA','Unsupported essay schema reference');
      const {$ref,...rest}=value;
      return visit({...target,...rest});
    }
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,visit(item)]));
  }
  return visit(schema);
}

function request(prompt, options={}, env=process.env) {
  // Reuse the exact teaching prompt and evidence contract; change only the
  // provider's wire format. Reasoning models use Responses, without temperature.
  const original=claudeFormat.request(prompt,claudeFormat.essayModel(env),options);
  const tool=original.tools?.[0];
  return {model:model(env),store:false,input:original.messages,
    reasoning:{effort:env.ESSAY_OPENAI_REASONING_EFFORT || 'medium'},
    max_output_tokens:Math.max(4500,original.max_tokens),
    ...(tool ? {parallel_tool_calls:false,
      tools:[{type:'function',name:tool.name,description:tool.description,parameters:wireSchema(tool.input_schema),strict:true}],
      tool_choice:{type:'function',name:tool.name}}
      : {text:{format:{type:'json_object'}}})};
}

function invalid(code,message) { return Object.assign(new Error(message),{code}); }
function response(value, options={}) {
  if(value?.status==='incomplete')throw invalid('ESSAY_TRUNCATED','Incomplete essay assessment');
  if(value?.status!=='completed' || !Array.isArray(value.output))throw invalid('ESSAY_OUTPUT_FORMAT','Missing completed essay assessment');
  const tool=claudeFormat.toolFor(options.stage);
  let data;
  if(tool) {
    const calls=value.output.filter(item=>item.type==='function_call');
    if(calls.length!==1 || calls[0].name!==tool.name || calls[0].status!=='completed')throw invalid('ESSAY_OUTPUT_FORMAT','Missing structured essay assessment');
    try { data=JSON.parse(calls[0].arguments); } catch {throw invalid('ESSAY_OUTPUT_FORMAT','Invalid structured essay assessment');}
  } else {
    const content=value.output.filter(item=>item.type==='message').flatMap(item=>item.content || []);
    if(content.some(item=>item.type==='refusal'))throw invalid('ESSAY_OUTPUT_FORMAT','Essay sample could not be prepared');
    try { data=JSON.parse(content.filter(item=>item.type==='output_text').map(item=>item.text).join('')); }
    catch { throw invalid('ESSAY_OUTPUT_FORMAT','Invalid essay sample output'); }
  }
  if(!data || typeof data!=='object' || Array.isArray(data))throw invalid('ESSAY_OUTPUT_FORMAT','Missing essay assessment object');
  return data;
}
module.exports={model,request,response};
