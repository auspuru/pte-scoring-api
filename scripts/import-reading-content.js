'use strict';
// Run with the JSON export of PRACTICE_SETS, RFIB_PASSAGES and RDWD_PASSAGES
// from auspuru/reading-practice at the source commit recorded below.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source={url:'https://pte.up.railway.app/',repository:'auspuru/reading-practice',commit:'439880edb0989697275809e9e82b00eb0c3176e9'};
function convert(p,type){
  const q={id:p.id,uid:'pte:'+p.id,title:p.title,type,passage:p.passage.replace(/\[BLANK_(\d+)\]/g,(_,i)=>'[['+(Number(i)+1)+']]'),topic:p.topic,difficulty:p.difficulty};
  q.instructions=type==='dropdown'?'Read the text and select the best word for each blank.':'Read the text and drag the words into the blanks. You can also select a word, then select a blank.';
  q.answers=type==='dropdown'?p.blanks.map(b=>b.correct):p.answers;
  if(type==='dropdown')q.options=p.blanks.map(b=>b.options);else q.bank=p.wordBank;
  q.reasoning={correct:'Review the answers and explanations for each blank.',blanks:type==='dropdown'?p.blanks.map(b=>({answer:b.correct,explanation:b.explanation,meaning:b.meaningInContext||''})):p.answers.map((answer,i)=>({answer,explanation:p.explanations[i],meaning:''}))};
  if(p.distractorNotes)q.reasoning.options=p.distractorNotes;
  assert.equal([...q.passage.matchAll(/\[\[\d+\]\]/g)].length,q.answers.length,p.id);
  q.answers.forEach((answer,i)=>assert((q.options?.[i]||q.bank).includes(answer),p.id));
  assert(q.reasoning.blanks.every(b=>typeof b.explanation==='string'&&b.explanation.trim()),p.id);
  return q;
}
function hiw(item){
  const spoken=item.audioText.split(/\s+/),written=[...spoken],corrections=[];
  for(const [word,replacement,explanation] of item.changes){
    const positions=spoken.flatMap((token,i)=>token===word?[i]:[]);
    assert.equal(positions.length,1,item.id+': '+word+' must identify exactly one word');
    assert(!/\s/.test(replacement));const index=positions[0];written[index]=replacement;
    corrections.push({index,written:replacement,spoken:word,explanation});
  }
  corrections.sort((a,b)=>a.index-b.index);
  return {id:item.id,uid:'ipt:'+item.id,type:'hiw',title:item.title,cefrTarget:'C2',instructions:'Listen and select the words in the transcript that differ from the audio. Select a word again to remove it.',audioText:item.audioText,passage:written.join(' '),answers:corrections.map(c=>c.index),corrections,reasoning:{correct:'Compare the written words with the recording. The explanations below show how each substitution changes the meaning.'}};
}
function build(input){
  const bankPath=path.join(root,'public/reading-bank.json'),bank=JSON.parse(fs.readFileSync(bankPath,'utf8'));
  const importedSets=input.PRACTICE_SETS.map(s=>({id:'pte-'+s.id.toLowerCase(),sourceId:s.id,sourceTitle:s.title,sourceMinutes:s.timeLimitMinutes,minutes:25,questions:s.passages.map(p=>convert(p.passage,p.type==='rfib'?'dropdown':'wordbank'))}));
  assert.equal(importedSets.length,6);assert.equal(input.RFIB_PASSAGES.length,50);assert.equal(input.RDWD_PASSAGES.length,50);
  bank.version=7;bank.importedSets=importedSets;bank.sourceImports={...source,mockSets:6,dropdownQuestions:50,dragAndDropQuestions:50};
  bank.mockCatalogue=bank.mockCatalogue.filter(m=>m.kind!=='reading-blanks');
  for(const preset of bank.mockCatalogue)preset.name=(preset.family==='practice'?'Practice':'Sectional')+' mock test '+preset.id.match(/\d+$/)[0];
  importedSets.forEach((s,i)=>bank.mockCatalogue.push({id:'practice-mock-'+(i+4),name:'Practice mock test '+(i+4),family:'practice',kind:'reading-blanks',setId:s.id,timed:true,minutes:25}));
  const authored=JSON.parse(fs.readFileSync(path.join(root,'content/hiw-c2.json'),'utf8'));
  bank.practiceLibraries=[
    {id:'dropdown',name:'Reading dropdown blanks',questions:input.RFIB_PASSAGES.map(p=>convert(p,'dropdown'))},
    {id:'wordbank',name:'Reading drag and drop',questions:input.RDWD_PASSAGES.map(p=>convert(p,'wordbank'))},
    {id:'hiw',name:'Highlight Incorrect Words',questions:authored.map(hiw)}
  ];
  fs.writeFileSync(bankPath,JSON.stringify(bank,null,2)+'\n');
  return {mocks:importedSets.length,practice:bank.practiceLibraries.map(l=>({name:l.name,questions:l.questions.length}))};
}
if(require.main===module){assert(process.argv[2],'Supply the source JSON export path');console.log(build(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))));}
module.exports={convert,hiw};
