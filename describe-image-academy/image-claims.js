// Scoring source: auspuru/Describe@e0141316c42516c56692b961a999b90efd848c33 (backend/image-claims.js).
'use strict';

// Ground simple change claims in the chart's data, not in the reviewer's prose.
// These checks intentionally abstain on negation, rankings, causes and ambiguous
// wording. They do not turn a few correct facts into a holistic content score.
function comparisons(mapping){
  const v=mapping?.visual;let panels=[];
  if(v?.kind==='pie')panels=v.panels||[];
  else if(v?.kind==='bar')panels=(v.series||[]).map(s=>({...s,labels:v.labels}));
  else if(v?.kind==='table'&&Array.isArray(v.rows))panels=(v.columns||[]).map((name,i)=>({name,labels:v.rows.map(r=>r.name),values:v.rows.map(r=>r.values?.[i])}));
  if(panels.length!==2||panels.some(p=>!/^\d{4}$/.test(String(p.name)))||Number(panels[0].name)>=Number(panels[1].name))return [];
  const [a,b]=panels,out=[];
  for(let i=0;i<(a.labels||[]).length;i++){
    const label=a.labels[i],j=b.labels?.indexOf(label),from=a.values?.[i],to=b.values?.[j];
    if(typeof label!=='string'||!Number.isInteger(j)||j<0||!Number.isFinite(from)||!Number.isFinite(to))continue;
    const factIndices=mapping.facts.flatMap((f,k)=>f.toLowerCase().includes(label.toLowerCase())?[k]:[]);
    if(!factIndices.length)continue;
    out.push({label,from:{period:String(a.name),value:from},to:{period:String(b.name),value:to},direction:to>from?'increased':to<from?'decreased':'unchanged',unit:v.unit,factIndices});
  }
  return out;
}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const directionPattern=/\b(?:increas(?:e[ds]?|ing)|ris(?:e[ns]?|ing)|rose|grew|grown|gain(?:ed|s|ing)?(?:\s+share)?|decreas(?:e[ds]?|ing)|fell|fallen|fall(?:s|ing)?|drop(?:ped|s|ping)?|lost\s+share|unchanged|constant|stable|(?:stay(?:ed|s)?|remain(?:ed|s)?)\s+(?:the\s+)?same)\b/gi;
function direction(word){return /unchanged|constant|stable|same/i.test(word)?'unchanged':/decreas|fell|fallen|fall|drop|lost/i.test(word)?'decreased':'increased'}
function verifiedNumbersRemoved(mapping,text){
  const rows=comparisons(mapping);if(!rows.length||! /\d/.test(text))return text;
  const periods=[rows[0].from.period,rows[0].to.period];
  for(const clause of text.split(/[,;.!?\n]|\b(?:whereas|while|however|although|but)\b/i)){
    const years=[...clause.matchAll(new RegExp('\\b(?:'+periods.join('|')+')\\b','g'))].map(m=>m[0]);
    if(years.includes(periods[0])&&years.includes(periods[1])&&years.indexOf(periods[1])<years.indexOf(periods[0]))return null;
    const withoutYears=clause.replace(new RegExp('\\b(?:'+periods.join('|')+')\\b','g'),'');
    const nums=(withoutYears.match(/\d+(?:\.\d+)?/g)||[]).map(Number);if(!nums.length)continue;
    const named=rows.filter(r=>new RegExp('\\b'+escape(r.label)+'\\b','i').test(clause));
    if(named.length!==1)return null;
    const r=named[0],a=r.from.value,b=r.to.value;
    if(r.direction==='unchanged'&&nums.every(n=>n===a))continue;
    if(nums.length===2&&nums[0]===a&&nums[1]===b)continue;
    if(nums.length===1){
      if(/\bby\b/i.test(clause)&&/\bpercentage\s+points?\b/i.test(clause)&&nums[0]===Math.abs(b-a))continue;
      if(/\bfrom\s+\d/i.test(clause)&&nums[0]===a)continue;
      if(/\bto\s+\d/i.test(clause)&&nums[0]===b)continue;
    }
    return null;
  }
  return text.replace(/\d+(?:\.\d+)?/g,'');
}
function changeClaims(mapping,text){
  const rows=comparisons(mapping),claims=[];if(!rows.length)return claims;
  let predicateIndex=0;
  for(const clause of text.split(/[,;.!?\n]|\b(?:whereas|while|however|although|but)\b/i)){
    // Do not treat 'did not increase', 'only Travel', or a causal claim as a
    // verified assertion that can protect the whole quote from an error review.
    if(/\b(?:not|no|never|only|except|because|due\s+to|if|might|could)\b/i.test(clause)||/\d/.test(clause))continue;
    const subjects=rows.flatMap(row=>[...clause.matchAll(new RegExp('\\b'+escape(row.label)+'\\b','gi'))].map(m=>({row,start:m.index,end:m.index+m[0].length})));
    subjects.sort((a,b)=>a.start-b.start);
    const predicates=[...clause.matchAll(directionPattern)];let previousEnd=0;
    for(const p of predicates){
      let candidates=subjects.filter(s=>s.start>=previousEnd&&s.end<=p.index);
      // Support a shared predicate: 'Health and Travel remained constant'. Do
      // not attach an earlier subject across an unrelated statement.
      if(candidates.length){
        let start=candidates.length-1;
        while(start>0&&/^\s*(?:(?:and|both|the|budget|budgets|share|shares|allocation|allocations|spending)\b\s*)*$/i.test(clause.slice(candidates[start-1].end,candidates[start].start)))start--;
        candidates=candidates.slice(start);
      }else if(predicates.length===1&&!subjects.some(s=>s.end<=p.index)&&/^(?:unchanged|constant|stable)$/i.test(p[0])){
        candidates=subjects.filter(s=>s.start>=p.index+p[0].length);
      }
      for(const s of candidates){
        const observed=direction(p[0]);claims.push({label:s.row.label,observed,expected:s.row.direction,status:observed===s.row.direction?'supported':'contradicted',factIndices:s.row.factIndices,predicateIndex});
      }
      predicateIndex++;
      previousEnd=p.index+p[0].length;
    }
  }
  return claims;
}
function supportedChangeQuote(mapping,text){
  text=verifiedNumbersRemoved(mapping,text);
  if(text===null||/\b(?:not|no|never|only|except|because|due\s+to|if|might|could|highest|lowest|largest|smallest|more|less)\b/i.test(text))return false;
  const claims=changeClaims(mapping,text),rows=comparisons(mapping);
  // Every named chart category and change predicate must have been checked.
  // A supported Health claim must not hide an unparsed Housing assertion.
  const named=rows.reduce((n,r)=>n+[...text.matchAll(new RegExp('\\b'+escape(r.label)+'\\b','gi'))].length,0);
  const predicates=[...text.matchAll(directionPattern)].length;
  return claims.length>0&&claims.length===named&&predicates===new Set(claims.map(c=>c.predicateIndex)).size&&claims.every(c=>c.status==='supported');
}
function unsupportedCriticism(mapping,text){
  return text.split(/(?<=[.!?])\s+|[,;]|\b(?:whereas|while|however|although|but)\b/i).some(clause=>
    !/\b(?:omit(?:ted|s|ting)?|missing|absent|numbers|figures|counts|values)\b/i.test(clause)&&/\b(?:incorrect(?:ly)?|inaccurate(?:ly)?|wrong(?:ly)?|mistake|error|confus(?:e[ds]?|ing)|contradict(?:s|ed)?)\b/i.test(clause)&&supportedChangeQuote(mapping,clause));
}
// A sparse reference summary cannot establish that an extra learner detail is
// false. Withhold a deduction explicitly based on that absence; never assign a
// replacement score. Other evidenced errors still go through normal review.
function unverifiedSourceDeduction(content){
  if(!Number.isInteger(content?.score)||content.score>=6)return false;
  const reason=[content.reason,content.nextStep,content.scoreImpact?.observation,content.scoreImpact?.impact].filter(Boolean).join(' ');
  const missingReference=/\b(?:not\s+(?:supported|verified|included|provided|present)|absent|missing)\s+(?:by|in|from)\s+(?:(?:the|supplied|provided|reference|verified)\s+)*(?:facts|fact\s+summary|reference\s+summary)\b/i.test(reason);
  const unsupportedDetails=/\b(?:unsupported|unverified)\s+(?:(?:smaller|extra|additional|numerical)\s+)*(?:categories|details|numbers|figures|values)\b/i.test(reason);
  const penalty=/\b(?:limit(?:s|ed)?|reduc(?:e[ds]?|ing)|lower(?:ed|s)?|inaccurate|incomplet(?:e|eness)|precision|omit(?:ting|ted)?|deduct(?:ion|ed|s)?|penali[sz](?:e[ds]?|ing))\b/i.test(reason);
  const explicitlyNoPenalty=/\b(?:no\s+(?:mark\s+)?deduction|(?:do(?:es)?\s+not|cannot|can't|never)\s+(?:justify|cause|warrant)\s+(?:a\s+)?(?:mark\s+)?deduction|not\s+penali[sz]ed)\b/i.test(reason);
  return (missingReference||unsupportedDetails)&&penalty&&!explicitlyNoPenalty;
}
const groundingInstructions=' Use image.comparisons as explicit category-by-category ground truth when supplied. Check each category separately: more than one category can remain unchanged. A shared predicate such as "A and B remained constant" applies to both named categories. Do not mix a changing category into that group unless the learner actually did so. A correct claim selected in supportedChangeQuotes cannot be used as inaccurate evidence or criticised as a factual mistake. Credit a correct, connected account of the main changes and unchanged categories. Missing optional values are omissions, not contradictions, and are not automatically a gap to full marks. Explain an accuracy deduction only with an actual learner quote that contradicts the source; do not repeat or invent an error elsewhere in reason, coverage or coaching.';
module.exports={comparisons,changeClaims,supportedChangeQuote,unsupportedCriticism,unverifiedSourceDeduction,groundingInstructions};
