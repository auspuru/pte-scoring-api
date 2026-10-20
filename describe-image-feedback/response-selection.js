'use strict';
const VERSION='key-features-40s-v1',MAX_REVISION_WORDS=100;
const wordCount=text=>text.trim().split(/\s+/).filter(Boolean).length;
function seriesSummary(s,labels){
  const values=s.values,first=values[0],last=values.at(-1);
  const changes=values.slice(1).map((v,i)=>Math.sign(v-values[i])).filter(Boolean);
  const turns=changes.slice(1).filter((d,i)=>d!==changes[i]).length;
  let shape=!changes.length?'unchanged':!turns?(changes[0]>0?'rising':'falling'):turns===1?(changes[0]>0?'rise-then-fall':'fall-then-recover'):'fluctuating';
  if(turns===2&&changes[0]===1&&changes.at(-1)===1&&first===Math.min(...values)&&last===Math.max(...values))shape='rising-with-dip';
  if(turns===2&&changes[0]===-1&&changes.at(-1)===-1&&first===Math.max(...values)&&last===Math.min(...values))shape='falling-with-rebound';
  let keyChange=null;
  if(shape==='rise-then-fall'||shape==='fall-then-recover'){
    const value=shape==='rise-then-fall'?Math.max(...values):Math.min(...values),i=values.indexOf(value);
    keyChange={kind:shape==='rise-then-fall'?'peak':'trough',period:labels[i],value};
  }
  if(shape==='rising-with-dip'||shape==='falling-with-rebound'){
    const i=values.findIndex((v,i)=>i>0&&i<values.length-1&&(shape==='rising-with-dip'?v<values[i-1]&&v<values[i+1]:v>values[i-1]&&v>values[i+1]));
    if(i>0)keyChange={kind:shape==='rising-with-dip'?'temporary-dip':'temporary-rebound',period:labels[i],value:values[i]};
  }
  return {name:s.name,start:{period:labels[0],value:first},end:{period:labels.at(-1),value:last},shape,keyChange};
}
function selectionPolicy(mapping){
  if(!['line','bar'].includes(mapping?.category))return null;
  const v=mapping.visual||{},labels=v.labels||[];
  const temporal=labels.length>1&&labels.every(x=>/^\d{4}$/.test(String(x)))&&labels.every((x,i)=>!i||Number(x)>Number(labels[i-1]));
  const raw=Array.isArray(v.series)?v.series:Array.isArray(v.values)?[{name:'Series',values:v.values}]:[];
  const series=temporal?raw.filter(s=>Array.isArray(s.values)&&s.values.length===labels.length&&s.values.every(Number.isFinite)).map(s=>seriesSummary(s,labels)):[];
  const groups=Object.entries(Object.groupBy(series,s=>s.shape)).map(([shape,items])=>({shape,names:items.map(s=>s.name)}));
  return {version:VERSION,responseSeconds:40,coverageMode:'key-features-and-relationships',intermediateFiguresRequired:false,individualSeriesNarrationRequired:false,
    strategy:series.length===1?'overall shape, beginning and end, and a meaningful change when present':series.length>1?'group shared movements, contrast the main groups, and select an important exception or relationship':mapping.category==='line'?'select the overall pattern and a meaningful change; group series when applicable':'select the main comparisons or time trend, using a few useful figures',
    series,groups,optionalReferenceFactIndices:mapping.optionalFactIndices||[],revision:{aimWords:[60,90],maximumNewWords:MAX_REVISION_WORDS,minimumWordsRequired:false}};
}
// Reject explicit checklist demands, not a request to explain a missing peak,
// reversal, contrast or other important relationship. This is a feedback check,
// never a rule that assigns a score from endpoints or a transcript word count.
function unrealisticDetailDemand(mapping,text){
  if(!selectionPolicy(mapping)||typeof text!=='string')return false;
  return text.split(/(?<=[.!?])\s+/).some(sentence=>{
    if(/\b(?:no\s+need|needn't|don't\s+need|do(?:es)?\s+not\s+need|not\s+required|(?:not|don't|never)\s+(?:list|mention|describe|include|add|report|provide|require))\b/i.test(sentence))return false;
    if(/\boptional(?:ly)?\b/i.test(sentence)&&!/\b(?:must|required|missing|incomplete|lower|reduce|deduct)\w*/i.test(sentence))return false;
    const demand=/\b(?:need(?:s|ed)?|must|required|should|include|add|mention|describe|provide|report|list|missing|omit(?:ted|ting|s)?|lack(?:s|ing)?|incomplete|lower(?:ed|s)?|reduce[ds]?|deduct(?:ed|s)?|limited|penalis(?:e[ds]?|ing))\b/i.test(sentence);
    if(!demand)return false;
    const exhaustive=/\b(?:all|every|each)\s+(?:(?:the|of\s+the|intermediate|individual|annual|yearly)\s+)*(?:data\s+points?|figures?|values?|numbers?|years?|time\s+points?)\b/i.test(sentence)||/\b(?:every|each|all)\s+(?:individual\s+)?(?:line|series|trend)s?\b[^.!?]*(?:\bindividually\b|\bseparately\b|\b(?:start|end|values|figures|numbers)\b)/i.test(sentence);
    if(exhaustive)return true;
    return /\bintermediate\s+(?:figures|values|numbers|data\s+points)\b/i.test(sentence)&&!/\b(?:peak|trough|dip|reversal|turning\s+point|crossover|overtak|recover|plateau|exception)\w*/i.test(sentence);
  });
}
function revisionTooLong(mapping,data,text){
  return !!selectionPolicy(mapping)&&typeof data?.revisedResponse==='string'&&data.revisedResponse!==text&&wordCount(data.revisedResponse)>MAX_REVISION_WORDS;
}
const selectionInstructions=` Apply responseSelectionPolicy when supplied. This is a 40-second selective description, not a data recital. For a single temporal line or bar series, an accurate overall shape, beginning, end and one meaningful change when present can support a strong or top-band response. Do not lower content solely because routine intermediate figures are omitted. On a straight rise, fall or steady series, do not invent a turning-point requirement. On a peak, dip or fluctuation, preserve the real shape: endpoints alone must not hide an important reversal. The exact value of a turning point is optional when its role is already clear. For several lines, accept a grouped description of shared movements plus the important contrast, exception or changing relationship. Do not require separate start/end/intermediate figures or an individual narration for every series. Distinct important trend groups still matter; ignoring a major opposite movement is a real omission. Use one or two representative numerical comparisons when useful, preserving accurate units and percentages already stated. Fact coverage is a reference map, not a checklist or a percentage-based content score: partial coverage of an optional chronology does not mean the student described its main trend incompletely. Scores below 6 need an important accuracy, selection, relationship or clarity gap; omitted routine figures alone cannot justify the deduction. Do not automatically award full marks from endpoints or fact matching. Keep the student's actual response unrestricted by a minimum word count. For NEW full-response graph revisions, aim for 60–90 words and stay within ${MAX_REVISION_WORDS} words; never expand a good answer into a full series-by-series script or tell the student to rush. Preserve an already good unchanged response. Give one realistic next priority; identify extra numerical detail as optional polish, not a requirement for full marks.`;
module.exports={VERSION,MAX_REVISION_WORDS,wordCount,selectionPolicy,unrealisticDetailDemand,revisionTooLong,selectionInstructions};

