// Scoring source: auspuru/Describe@e0141316c42516c56692b961a999b90efd848c33 (backend/chart-readings.js).
'use strict';
// Explicit readings are checked against the original chart during the image
// audit. These checks reject a contradictory review; they never award a mark.
const escape=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const readings=mapping=>(mapping?.visual?.verifiedReadings||[]).filter(r=>typeof r.label==='string'&&Number.isFinite(r.value)&&Number.isInteger(r.factIndex));
const labelPattern=r=>new RegExp('(?<![\\w.])(?:'+(r.aliases||[r.label]).map(escape).join('|')+')(?![\\w.])','gi');
function mentions(r,text){
  return [...text.matchAll(labelPattern(r))].some(m=>!/^\d+$/.test(r.label)||!/(?:less\s+than|under|below|over|more\s+than)\s*$/i.test(text.slice(0,m.index)));
}
function evidence(r,text){
  const value=new RegExp('^([^\\d.!?;]{0,130})'+escape(r.value)+'(?:\\.0+)?\\s*(?:%|per\\s*cent\\b|percent\\b)','i');
  for(const m of text.matchAll(labelPattern(r))){
    if(/^\d+$/.test(r.label)&&/(?:less\s+than|under|below|over|more\s+than)\s*$/i.test(text.slice(0,m.index)))continue;
    const tail=text.slice(m.index+m[0].length),found=tail.match(value);
    if(found){
      const start=Math.max(text.lastIndexOf('.',m.index)+1,text.lastIndexOf(';',m.index)+1,0),span=text.slice(start,m.index+m[0].length+found[0].length);
      if(!/\b(?:not|never|no|if|maybe|might|could)\b/i.test(span))return span;
    }
  }
  return null;
}
function verifiedStrength(mapping,text){
  const supported=readings(mapping).filter(r=>{const e=evidence(r,text);return e&&hasRole(r,e)});
  if(!supported.length)return null;
  return {text:'You correctly identified '+supported.map(r=>`${r.label} at ${r.approximate?'about ':''}${r.value}%`).join(', ')+'.',quote:evidence(supported[0],text)};
}
function hasRole(r,text){return r.role==='minimum'?/\b(?:lowest|smallest|least|minimum)\b/i.test(text):r.role==='maximum'?/\b(?:highest|largest|greatest|maximum|peak)\b/i.test(text):true}
function reviewConflict(mapping,learner,review){
  if(typeof learner!=='string'||typeof review!=='string')return false;
  const known=readings(mapping).filter(r=>{const e=evidence(r,learner);return e&&hasRole(r,e)});
  return review.split(/(?<=[.!?])\s+|;/).some(sentence=>{
    const wrong=/\b(?:incorrect(?:ly)?|inaccurate(?:ly)?|wrong(?:ly)?|mistaken?|error|confus(?:e[ds]?|ing)|contradict(?:s|ed)?)\b/i.test(sentence);
    const absent=/\b(?:include|add|mention|missing|omit(?:ted|s|ting)?|absent|lack(?:s|ing)?)\b/i.test(sentence);
    return known.some(r=>mentions(r,sentence)&&((wrong&&r.role&&hasRole(r,sentence))||(absent&&evidence(r,sentence))));
  });
}
function optionalFactGap(mapping,content){
  const gap=content?.scoreImpact,optional=new Set(mapping?.optionalFactIndices||[]);
  return Number.isInteger(content?.score)&&content.score<6&&gap&&gap.kind!=='accuracy'&&gap.factIndices?.length>0&&gap.factIndices.every(i=>optional.has(i));
}
const instructions=' Read image.verifiedReadings as audited chart readings. Keep the horizontal category separate from the vertical quantity: the category with the lowest percentage is not necessarily the smallest category label. In a distribution, saying a ratio is highest or lowest followed by its percentage refers to bar height when that meaning is clear. Credit an already stated value anywhere in the full transcript, including the final sentence. Do not ask for it again as missing. Nearby bars and routine extra figures marked optionalFactIndices are optional reference details, not requirements for full marks. Correct primary features must be credited even when optional details are omitted.';
module.exports={readings,evidence,reviewConflict,optionalFactGap,verifiedStrength,instructions};
