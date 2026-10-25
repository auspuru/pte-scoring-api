'use strict';
// Use the same forced structured-tool pattern as the portal's SWT reviewer.
// Student word spans avoid asking the model to retype long spoken quotations.
const NAME='submit_speaking_content';
const applies=q=>['di','rl','sgd','rts'].includes(q?.type);
const string={type:'string'},boolean={type:'boolean'};
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const span={type:'array',items:{type:'integer'},description:'Two student word numbers [first,last], 1-based inclusive. Select a short passage (about 6–25 words), never a source quotation. Use [] only for a missing coverage item.'};
function tool(q){
  const properties={total:{type:'integer',enum:[0,1,2,3,4,5,6]},overview:string,
    strengths:{type:'array',items:string},improvements:{type:'array',items:string}};
  if(q.type==='rts')properties.communicationAssessment=object({
    level:{type:'string',enum:['effective','mostly_effective','partial','limited','none']},
    materialProblem:boolean,evidence_span:span,reason:string
  });
  else {
    properties.coverage={type:'array',description:'One item per supplied fact, in zero-based order. Coverage is diagnostic, not a count-based content score.',items:object({
      point:{type:'integer',enum:q.facts.map((_,i)=>i)},status:{type:'string',enum:['covered','partial','missing','inaccurate']},
      evidence_span:span,feedback:string,errorImpact:{type:'string',enum:['none','minor','material'],description:'minor or material for inaccurate items; none otherwise.'}
    })};
    if(q.type!=='di')properties.summaryAssessment=object({responseForm:{type:'string',enum:['template_only','keywords','fragments','connected']},
      mainMessageAccurate:boolean,relationshipsClear:boolean,sufficientSubstance:boolean,mostlyAccurate:boolean,
      materialMeaningChange:boolean,speakerAttributionClear:boolean,evidence_span:span,reason:string});
  }
  if(q.type==='di'){
    const refs={type:'array',items:{type:'integer',enum:q.facts.map((_,i)=>i)}};
    properties.coaching=object({priority:{type:'string',enum:['accuracy','selection','grouping','relationship','expression','none']},
      strength:object({quote_span:{...span,description:'Exact student strength word span [first,last], or [] with empty why when there is no supported strength.'},why:string}),
      changes:{type:'array',items:object({quote_span:span,rewrite:string,why:string,factIndices:refs})},
      revisedResponse:string,rewriteFactIndices:refs,tip:string,nextTry:string});
  }
  return {name:NAME,strict:true,description:'Return the complete content assessment using the supplied institute policy. This tool records assessment data only; it performs no external action. Evaluate meaning before choosing the score.',input_schema:object(properties)};
}
function words(text){return Array.from(text.matchAll(/\S+/gu),m=>({word:m[0],start:m.index,end:m.index+m[0].length}));}
function request(prompt,model,context={}){
  const academy=require('./describe-image-academy');
  if(academy.applies(context))return academy.request(model,context);
  const {question,transcript='',validationDiagnostic}=context;
  if(!applies(question))return {model,temperature:0,max_tokens:3200,messages:[{role:'user',content:prompt}]};
  const specification=tool(question);
  if(validationDiagnostic?.fullEligible===false&&Number.isInteger(validationDiagnostic.ceiling)){
    const ceiling=Math.max(0,Math.min(5,validationDiagnostic.ceiling));
    specification.input_schema.properties.total.enum=Array.from({length:ceiling+1},(_,i)=>i);
  }
  const numbered=words(transcript).map((w,i)=>`${i+1}:${w.word}`).join(' ');
  return {model,temperature:0,max_tokens:4000,tools:[specification],tool_choice:{type:'tool',name:NAME},
    messages:[{role:'user',content:prompt+'\n\nSTRUCTURED OUTPUT: Use submit_speaking_content instead of the earlier JSON-only or no-tool-call output instruction. Return every required field. In this wire format replace each evidence quotation with evidence_span from NUMBERED_STUDENT_WORDS below; replace coaching quotes with quote_span using the SAME student word numbers. The server restores the exact original words. Keep quotations short and contiguous (under 500 characters). Missing coverage uses []. A coaching strength with no real quote uses quote_span=[] and why="". Never use source/sample word numbers. Keep strengths, improvements and coaching changes to at most two each. Choose total consistently with the semantic assessment flags and the institute policy.\nNUMBERED_STUDENT_WORDS='+numbered}]};
}
function response(value,context={}){
  const academy=require('./describe-image-academy');
  if(academy.applies(context))return academy.response(value,context);
  const {question,transcript=''}=context;
  if(value?.stop_reason==='max_tokens')throw Object.assign(Error('Incomplete content assessment.'),{code:'SPEAKING_TRUNCATED'});
  if(!applies(question))return JSON.parse(value.content.filter(item=>item.type==='text').map(item=>item.text).join('\n').match(/\{[\s\S]*\}/)?.[0]||'null');
  const raw=value?.content?.find(item=>item.type==='tool_use'&&item.name===NAME)?.input;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Object.assign(Error('Incomplete content assessment.'),{code:'SPEAKING_MISSING_TOOL'});
  const numbered=words(transcript);
  function evidence(item,missing=false){
    const indices=item?.evidence_span;
    if(missing&&Array.isArray(indices)&&!indices.length)return '';
    if(!Array.isArray(indices)||indices.length!==2||!indices.every(Number.isInteger)||indices[0]<1||indices[1]<indices[0]||indices[1]>numbered.length)
      throw Object.assign(Error('Unsupported assessment evidence. Please retry.'),{code:'SPEAKING_EVIDENCE_SPAN'});
    const quote=transcript.slice(numbered[indices[0]-1].start,numbered[indices[1]-1].end);
    if(missing||quote.length>500)throw Object.assign(Error('Unsupported assessment evidence. Please retry.'),{code:'SPEAKING_EVIDENCE_SPAN'});
    return quote;
  }
  const restore=(item,missing=false)=>{const {evidence_span,...rest}=item||{};return {...rest,evidence:evidence(item,missing)};};
  return {...raw,...(question.type==='rts'?{communicationAssessment:restore(raw.communicationAssessment)}:{
    coverage:Array.isArray(raw.coverage)?raw.coverage.map(item=>restore(item,item.status==='missing')):raw.coverage,
    ...(question.type==='di'?{}:{summaryAssessment:restore(raw.summaryAssessment)})
  }),...(question.type==='di'?{
    // Coaching remains independently validated. An absent or malformed coach
    // must never discard an otherwise valid content assessment.
    coaching:(()=>{try{
      const coach=raw.coaching;
      const quote=item=>{const {quote_span,...rest}=item;return {...rest,quote:evidence({evidence_span:quote_span})};};
      return {...coach,strength:coach.strength?.quote_span?.length===0?null:quote(coach.strength),changes:coach.changes.map(quote)};
    }catch{return null;}})()
  }:{})};
}
module.exports={NAME,applies,tool,request,response};
