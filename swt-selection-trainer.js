'use strict';

const normalize = value => String(value || '').replace(/\s+/g,' ').trim();
const lower = value => normalize(value).toLowerCase();
const STOP = new Set('the a an and or but to of in on for with by from as at is are was were be been being this that these those it its their his her into than then while if so such not can could would should may might will do does did have has had'.split(' '));

function splitSentences(text) {
  const source = normalize(text);
  if (!source) return [];
  try {
    if (typeof Intl?.Segmenter === 'function') {
      return [...new Intl.Segmenter('en',{granularity:'sentence'}).segment(source)]
        .map(x=>normalize(x.segment)).filter(Boolean);
    }
  } catch (_) {}
  return source.split(/(?<=[.!?])\s+(?=(?:["“']?[A-Z0-9]))/).map(normalize).filter(Boolean);
}

function sentenceSegments(text) {
  const source=String(text||'');
  if(!source.trim())return [];
  try {
    if(typeof Intl?.Segmenter==='function'){
      return [...new Intl.Segmenter('en',{granularity:'sentence'}).segment(source)].map(segment=>{
        const raw=segment.segment||'',leading=(raw.match(/^\s*/)||[''])[0].length,trailing=(raw.match(/\s*$/)||[''])[0].length;
        const start=segment.index+leading,end=segment.index+raw.length-trailing;
        return {start,end,text:source.slice(start,end)};
      }).filter(x=>x.end>x.start);
    }
  } catch (_) {}
  const parts=splitSentences(source),out=[];let cursor=0;
  for(const part of parts){
    const words=part.split(/\s+/).filter(Boolean);if(!words.length)continue;
    const first=source.toLowerCase().indexOf(words[0].toLowerCase(),cursor);
    if(first<0)continue;
    let end=first+words[0].length;
    const tail=words.at(-1),tailAt=source.toLowerCase().indexOf(tail.toLowerCase(),Math.max(first,end-1));
    if(tailAt>=0)end=tailAt+tail.length;
    out.push({start:first,end,text:source.slice(first,end)});cursor=end;
  }
  return out;
}

function tokens(text) {
  return (lower(text).match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g)||[])
    .filter(w=>w.length>2&&!STOP.has(w));
}
function overlapScore(a,b) {
  const A=new Set(tokens(a)),B=new Set(tokens(b));
  if(!A.size||!B.size)return 0;
  let hit=0; for(const x of A)if(B.has(x))hit++;
  return hit/Math.max(1,Math.min(A.size,B.size));
}
function phraseIndexes(sentences, phrase) {
  const p=lower(phrase); if(!p)return [];
  return sentences.map((s,i)=>lower(s).includes(p)?i:-1).filter(i=>i>=0);
}
function bestSentence(sentences, idea) {
  let best=-1,score=0;
  sentences.forEach((s,i)=>{const value=overlapScore(s,idea);if(value>score){score=value;best=i;}});
  return score>=0.16?best:-1;
}
function bestRationale(item, passage) {
  const entries=Object.values(passage?.keyElementsRationale?.elements||{}).filter(Boolean);
  let best='',score=0;
  for(const value of entries){const v=overlapScore(value,item.idea);if(v>score){score=v;best=value;}}
  return best || passage?.keyElementsRationale?.importance || passage?.keyElementsRationale?.topic
    || 'This idea carries part of the passage’s main argument rather than a supporting example.';
}
function findPhraseRanges(source, phrase) {
  const hay=String(source||''),needle=normalize(phrase);
  if(!hay||!needle)return [];
  const lowerHay=hay.toLowerCase(),lowerNeedle=needle.toLowerCase(),out=[];let at=0;
  while(at<lowerHay.length){
    const start=lowerHay.indexOf(lowerNeedle,at);if(start<0)break;
    out.push({start,end:start+needle.length,text:hay.slice(start,start+needle.length),kind:'phrase'});
    at=start+Math.max(1,needle.length);
  }
  return out;
}
function rangeOverlap(a,b){return Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));}
function mergeRanges(ranges) {
  const sorted=(ranges||[]).filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>r.start)
    .sort((a,b)=>a.start-b.start||a.end-b.end);
  const out=[];
  for(const r of sorted){
    const last=out.at(-1);
    if(last&&r.start<=last.end){
      last.end=Math.max(last.end,r.end);
      if(last.kind!==r.kind)last.kind='mixed';
    }else out.push({...r});
  }
  return out;
}
function paragraphRanges(source) {
  const text=String(source||''),out=[];let start=0;
  const push=(a,b)=>{
    while(a<b&&/\s/.test(text[a]))a++;
    while(b>a&&/\s/.test(text[b-1]))b--;
    if(b>a)out.push({start:a,end:b,text:text.slice(a,b)});
  };
  const re=/\n\n+/g;let match;
  while((match=re.exec(text))){push(start,match.index);start=match.index+match[0].length;}
  push(start,text.length);
  return out.length?out:[{start:0,end:text.length,text}];
}

function answerKey(passage) {
  const source=String(passage?.text||''),segments=sentenceSegments(source),sentences=segments.map(x=>normalize(x.text));
  const guideItems=(passage?.studyGuide?.items||[]).filter(x=>x&&x.idea);
  const targets=guideItems.map((item,order)=>{
    const phrases=(item.phrases||[]).map(normalize).filter(Boolean);
    const exactRanges=phrases.flatMap(p=>findPhraseRanges(source,p));
    const phraseHits=[...new Set(phrases.flatMap(p=>phraseIndexes(sentences,p)))];
    const fallbackIndex=exactRanges.length? -1 : bestSentence(sentences,item.idea);
    const fallbackRange=fallbackIndex>=0&&segments[fallbackIndex]
      ? [{...segments[fallbackIndex],kind:'fallback'}] : [];
    const ranges=mergeRanges(exactRanges.length?exactRanges:fallbackRange);
    const sentenceIndexes=[...new Set([...phraseHits,...(fallbackIndex>=0?[fallbackIndex]:[])])];
    return {
      order,label:normalize(item.label)||('Key idea '+(order+1)),idea:normalize(item.idea),
      why:normalize(bestRationale(item,passage)),phrases,ranges,sentenceIndexes
    };
  }).filter(x=>x.ranges.length);
  return {
    source,sentences,segments,targets,
    targetSentenceIndexes:[...new Set(targets.flatMap(t=>t.sentenceIndexes))].sort((a,b)=>a-b),
    targetRanges:mergeRanges(targets.flatMap(t=>t.ranges))
  };
}

function eligible(passage) {
  const key=answerKey(passage);
  return !!passage?.id && key.sentences.length>=3 && key.targets.length>=2;
}
function makeCatalog(passages,{limit=15}={}) {
  return (Array.isArray(passages)?passages:[]).filter(eligible)
    .sort((a,b)=>Number(a.id)-Number(b.id)).slice(0,Math.max(10,Math.min(20,limit)))
    .map(p=>({id:String(p.id),title:normalize(p.title)||('Passage '+p.id),category:normalize(p.category),sentenceCount:splitSentences(p.text).length}));
}
function exercise(passage) {
  const key=answerKey(passage),source=String(passage?.text||'');
  return {
    id:String(passage.id),title:normalize(passage.title)||('Passage '+passage.id),category:normalize(passage.category),
    instructions:'Read the paragraph normally. Drag across the exact words or phrases you believe carry the central message or essential supporting ideas. You can highlight several phrases. Do not write a summary.',
    text:source,paragraphs:paragraphRanges(source),
    sentences:key.sentences.map((text,index)=>({index,text}))
  };
}
function trimSelection(source,start,end) {
  while(start<end&&/\s/.test(source[start]))start++;
  while(end>start&&/\s/.test(source[end-1]))end--;
  return {start,end,text:source.slice(start,end)};
}
function sanitizeRangeSelections(source,selected) {
  const ranges=(Array.isArray(selected)?selected:[]).slice(0,30).map(item=>{
    const start=Number(item?.start),end=Number(item?.end);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>source.length||end<=start)return null;
    return trimSelection(source,start,end);
  }).filter(r=>r&&r.end>r.start&&r.text.length>=2&&r.text.length<=500);
  return mergeRanges(ranges).map(r=>({...r,text:source.slice(r.start,r.end)}));
}
function rangeMatchesTarget(selection,target) {
  const selectedText=selection.text||'';
  for(const range of target.ranges||[]){
    const overlap=rangeOverlap(selection,range);if(!overlap)continue;
    const targetCoverage=overlap/Math.max(1,range.end-range.start);
    const selectedCoverage=overlap/Math.max(1,selection.end-selection.start);
    if(range.kind==='phrase'&&(targetCoverage>=0.35||selectedCoverage>=0.65||overlapScore(selectedText,range.text)>=0.5))return true;
    if(range.kind!=='phrase'&&selectedCoverage>=0.6&&overlapScore(selectedText,target.idea)>=0.18)return true;
  }
  return overlapScore(selectedText,target.idea)>=0.34;
}
function rangeGrade(passage,selected) {
  const key=answerKey(passage),chosen=sanitizeRangeSelections(key.source,selected);
  const targetMatches=key.targets.map(target=>({target,matches:chosen.filter(sel=>rangeMatchesTarget(sel,target))}));
  const captured=targetMatches.filter(x=>x.matches.length).map(x=>x.target);
  const missed=targetMatches.filter(x=>!x.matches.length).map(x=>x.target);
  const correctRanges=chosen.filter(sel=>key.targets.some(target=>rangeMatchesTarget(sel,target)));
  const extraRanges=chosen.filter(sel=>!key.targets.some(target=>rangeMatchesTarget(sel,target)));
  const recall=key.targets.length?captured.length/key.targets.length:0;
  const precision=chosen.length?correctRanges.length/chosen.length:0;
  const overall=Math.round(((recall*0.7)+(precision*0.3))*100);
  return {
    mode:'phrases',passageId:String(passage.id),score:overall,
    ideaRecall:{captured:captured.length,total:key.targets.length,percent:Math.round(recall*100)},
    selectionPrecision:{correct:correctRanges.length,selected:chosen.length,percent:Math.round(precision*100)},
    selectedRanges:chosen,correctRanges,extraRanges,targetRanges:key.targetRanges,
    capturedIdeas:captured.map(t=>({label:t.label,idea:t.idea,ranges:t.ranges,phrases:t.phrases})),
    missedIdeas:missed.map(t=>({label:t.label,idea:t.idea,why:t.why,ranges:t.ranges,phrases:t.phrases})),
    centralIdeas:key.targets.map(t=>({label:t.label,idea:t.idea,why:t.why,ranges:t.ranges,phrases:t.phrases})),
    centralPhrases:[...new Set(key.targets.flatMap(t=>t.ranges.map(r=>key.source.slice(r.start,r.end))))],
    feedback:missed.length
      ? 'You missed '+missed.length+' essential idea'+(missed.length===1?'':'s')+'. Review the central phrases highlighted after checking and the explanation for each missed idea.'
      : extraRanges.length
        ? 'You found all essential ideas. Now make your highlighting tighter by removing phrases that are useful context but not necessary for the summary.'
        : 'Excellent content selection. Your highlighted phrases cover the essential ideas without unnecessary detail.'
  };
}
function legacyGrade(passage,selected=[]) {
  const key=answerKey(passage);
  const chosen=[...new Set((Array.isArray(selected)?selected:[]).map(Number).filter(i=>Number.isInteger(i)&&i>=0&&i<key.sentences.length))].sort((a,b)=>a-b);
  const selectedSet=new Set(chosen);
  const captured=key.targets.filter(t=>t.sentenceIndexes.some(i=>selectedSet.has(i)));
  const missed=key.targets.filter(t=>!t.sentenceIndexes.some(i=>selectedSet.has(i)));
  const targetSet=new Set(key.targetSentenceIndexes);
  const extra=chosen.filter(i=>!targetSet.has(i));
  const correctSelected=chosen.filter(i=>targetSet.has(i));
  const recall=key.targets.length?captured.length/key.targets.length:0;
  const precision=chosen.length?correctSelected.length/chosen.length:0;
  const phraseBySentence={};
  for(const t of key.targets)for(const i of t.sentenceIndexes)phraseBySentence[i]=[...new Set([...(phraseBySentence[i]||[]),...t.phrases])];
  return {
    mode:'sentences',passageId:String(passage.id),score:Math.round(((recall*0.7)+(precision*0.3))*100),
    ideaRecall:{captured:captured.length,total:key.targets.length,percent:Math.round(recall*100)},
    selectionPrecision:{correct:correctSelected.length,selected:chosen.length,percent:Math.round(precision*100)},
    selected:chosen,correctSelected,extraSelections:extra,targetSentenceIndexes:key.targetSentenceIndexes,phraseBySentence,
    capturedIdeas:captured.map(t=>({label:t.label,idea:t.idea,sentenceIndexes:t.sentenceIndexes,phrases:t.phrases})),
    missedIdeas:missed.map(t=>({label:t.label,idea:t.idea,why:t.why,sentenceIndexes:t.sentenceIndexes,phrases:t.phrases})),
    centralIdeas:key.targets.map(t=>({label:t.label,idea:t.idea,why:t.why,sentenceIndexes:t.sentenceIndexes,phrases:t.phrases})),
    feedback:missed.length?'You missed '+missed.length+' essential idea'+(missed.length===1?'':'s')+'.':extra.length?'You found all essential ideas. Tighten your selection.':'Excellent content selection.'
  };
}
function grade(passage,selected=[]) {
  return Array.isArray(selected)&&selected.some(x=>x&&typeof x==='object') ? rangeGrade(passage,selected) : legacyGrade(passage,selected);
}

module.exports={splitSentences,sentenceSegments,answerKey,eligible,makeCatalog,exercise,grade,rangeGrade,sanitizeRangeSelections};
