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

function answerKey(passage) {
  const sentences=splitSentences(passage?.text);
  const guideItems=(passage?.studyGuide?.items||[]).filter(x=>x&&x.idea);
  const targets=guideItems.map((item,order)=>{
    const phraseHits=[...new Set((item.phrases||[]).flatMap(p=>phraseIndexes(sentences,p)))];
    const fallback=phraseHits.length?[]:[bestSentence(sentences,item.idea)].filter(i=>i>=0);
    return {
      order,label:normalize(item.label)||('Key idea '+(order+1)),idea:normalize(item.idea),
      why:normalize(bestRationale(item,passage)),phrases:(item.phrases||[]).map(normalize).filter(Boolean),
      sentenceIndexes:[...new Set([...phraseHits,...fallback])]
    };
  }).filter(x=>x.sentenceIndexes.length);
  return {sentences,targets,targetSentenceIndexes:[...new Set(targets.flatMap(t=>t.sentenceIndexes))].sort((a,b)=>a-b)};
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
  const key=answerKey(passage);
  return {
    id:String(passage.id),title:normalize(passage.title)||('Passage '+passage.id),category:normalize(passage.category),
    instructions:'Highlight only the sentences you believe carry the central message or essential supporting ideas. Do not write a summary.',
    sentences:key.sentences.map((text,index)=>({index,text}))
  };
}
function grade(passage,selected=[]) {
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
  const overall=Math.round(((recall*0.7)+(precision*0.3))*100);
  const phraseBySentence={};
  for(const t of key.targets)for(const i of t.sentenceIndexes){
    phraseBySentence[i]=[...new Set([...(phraseBySentence[i]||[]),...t.phrases])];
  }
  return {
    passageId:String(passage.id),score:overall,
    ideaRecall:{captured:captured.length,total:key.targets.length,percent:Math.round(recall*100)},
    selectionPrecision:{correct:correctSelected.length,selected:chosen.length,percent:Math.round(precision*100)},
    selected:chosen,correctSelected,extraSelections:extra,targetSentenceIndexes:key.targetSentenceIndexes,
    phraseBySentence,
    capturedIdeas:captured.map(t=>({label:t.label,idea:t.idea,sentenceIndexes:t.sentenceIndexes,phrases:t.phrases})),
    missedIdeas:missed.map(t=>({label:t.label,idea:t.idea,why:t.why,sentenceIndexes:t.sentenceIndexes,phrases:t.phrases})),
    centralIdeas:key.targets.map(t=>({label:t.label,idea:t.idea,why:t.why,sentenceIndexes:t.sentenceIndexes,phrases:t.phrases})),
    feedback:missed.length
      ? 'You missed '+missed.length+' essential idea'+(missed.length===1?'':'s')+'. Review the highlighted central sentences and the explanation for each missed idea.'
      : extra.length
        ? 'You found all essential ideas. Now make your selection tighter by removing details that are useful but not necessary for the summary.'
        : 'Excellent content selection. You found the essential ideas without adding unnecessary detail.'
  };
}

module.exports={splitSentences,answerKey,eligible,makeCatalog,exercise,grade};
