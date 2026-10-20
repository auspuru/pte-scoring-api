'use strict';
// Listening-only papers. Reuse verified recordings without synthesising the
// same lecture again. Answer keys remain on the server until submission.
const bank = require('./writing-lab.json');
const predictions = require('./writing-predictions-sep-2026');
const sources = [...bank.spoken, ...bank.mocks.flatMap(m => m.questions), ...predictions.sst, ...(bank.dictation || [])];
const source = id => {
  const q = sources.find(q => q.id === id);
  if (!q) throw Error('Missing listening source: ' + id);
  return structuredClone(q);
};
const listeningFormat = {
  source: 'https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/resources/PTE-Academic-Test-Taker-Score-Guide.pdf',
  checkedAt: '2026-10-20',
  tasks: { sst:[1,1], lmcma:[2,3], lfi:[2,3], hcs:[2,3], lmcsa:[2,3], smw:[1,2], hiw:[2,3], wfd:[3,4] }
};
function choice(type, audioId, prompt, choices, correct, explanation) {
  const q = source(audioId);
  return { id:'listen-'+type+'-'+audioId, type, audioId, title:q.title, text:q.text,
    prompt, choices, ...(Array.isArray(correct) ? { answers:correct } : { answer:correct }), explanation };
}
const multiple = [
  choice('lmcma','sst-urban-trees','Which TWO points does the speaker make about urban trees?',
    ['Their main value is decorative.','They can cool streets and buildings.','Planting totals alone measure success.','They require suitable conditions and ongoing care.','The same species suits every neighbourhood.'],[1,3],
    'Shade and water released by leaves cool the surroundings. Suitable species, soil, root space and continued care determine survival.'),
  choice('lmcma','sst-active-learning','Which TWO revision methods does the speaker recommend?',
    ['Testing recall without looking at notes.','Rereading until every page feels familiar.','Spreading practice across several days.','Completing all revision in one long session.','Leaving incorrect answers unchecked.'],[0,2],
    'The speaker recommends retrieval practice and spaced revision, with feedback to correct mistakes.'),
  choice('lmcma','sst-food-waste','Which TWO actions can help prevent household food waste?',
    ['Buying every item on special offer.','Composting instead of changing purchasing habits.','Keeping leftovers out of sight.','Checking existing supplies before shopping.','Making food that needs using soon more visible.'],[3,4],
    'Checking supplies prevents duplicate purchases; visible storage makes it easier to use food before it is forgotten.'),
  choice('lmcma','sst-hybrid-work','Which TWO practices support effective hybrid work?',
    ['Requiring everyone to follow an identical schedule.','Making decisions accessible to remote colleagues.','Assessing employees through agreed outcomes.','Expecting staff to respond at every hour.','Judging contribution mainly by office attendance.'],[1,2],
    'Shared decisions and accessible meetings improve fairness, while agreed outcomes are more useful than physical presence.'),
  choice('lmcma','sst-community-museums','Which TWO responsibilities are mentioned for museums collecting personal stories?',
    ['Explaining to contributors how their words will be used.','Treating every memory as an independently verified fact.','Removing all conflicting accounts.','Prioritising recordings over long-term accessibility.','Distinguishing memories from verified information.'],[0,4],
    'Contributors should understand how stories will be used, and interpretation should distinguish personal memory from independently verified facts.'),
  choice('lmcma','sst-citizen-science','Which TWO measures help make volunteer observations reliable?',
    ['Collecting only in easily accessible parks.','Asking volunteers to guess uncertain identifications.','Providing clear recording instructions.','Allowing participants to report uncertainty.','Assuming that a larger dataset removes all error.'],[2,3],
    'Clear instructions and uncertainty reporting support reliable observations. More data alone does not remove bias or error.')
];
const summaries = [
  choice('hcs','sst-sleep-memory','Select the summary that best matches the recording.',[
    'Sleep can replace active study because memory develops automatically during rest.',
    'Students should sacrifice sleep to make room for longer revision sessions before an examination.',
    'Sleep supports learning alongside active recall and feedback; study plans should allow recovery, while research findings need careful interpretation.',
    'Researchers agree that every learner needs exactly the same timetable and amount of sleep.'
  ],2,'The lecture combines the value of sleep with active study and cautions against ignoring individual differences and research conditions.'),
  choice('hcs','sst-water-reuse','Select the summary that best matches the recording.',[
    'Water reuse can reduce demand for drinking water, but treatment, monitoring and infrastructure must fit local purposes and be compared with alternatives.',
    'Reused water is suitable for every purpose without further treatment, making monitoring unnecessary.',
    'Building water reuse systems is always cheaper than repairing leaks and should therefore replace every other strategy.',
    'Public communication is the only requirement for successful water reuse; technical standards are secondary.'
  ],0,'The speaker supports locally appropriate reuse with reliable treatment and monitoring, while considering costs and alternatives such as leak repair.'),
  choice('hcs','sst-public-transport','Select the summary that best matches the recording.',[
    'Lower fares are sufficient to persuade all drivers to use public transport.',
    'Bus networks should focus exclusively on people who already use them.',
    'Longer routes are the most effective way to make every bus journey predictable.',
    'Reliable buses require predictable journeys, better connections and infrastructure, with planning that considers whole trips and underserved communities.'
  ],3,'Affordable fares are not enough: dedicated lanes, efficient stops, connections and inclusive planning make journeys dependable.'),
  choice('hcs','sst-digital-archives','Select the summary that best matches the recording.',[
    'Keeping multiple copies guarantees that digital records will remain usable indefinitely.',
    'Digital preservation requires accessible formats, descriptive information, checked backups and careful migration, with resources focused on records of lasting value.',
    'Digital records should be deleted whenever new software becomes available.',
    'Preservation is a one-time task that ends when records are first scanned.'
  ],1,'The emphasis is continuing usability, rather than storage alone, through maintenance, migration and prioritisation.'),
  choice('hcs','sst-urban-pollinators','Select the summary that best matches the recording.',[
    'Pollinator habitats need connected food and shelter across seasons, locally suitable planting and continuing monitoring rather than colourful displays alone.',
    'Only large parks can support pollinators, so small gardens have no useful role.',
    'A short period of intense flowering supplies every insect with enough food for the whole year.',
    'Once flowering plants are installed, habitats no longer need monitoring or care.'
  ],0,'Seasonal variety, nesting spaces, links between green areas and continuing care support different pollinators.'),
  choice('hcs','sst-peer-feedback','Select the summary that best matches the recording.',[
    'Peer feedback works best when students replace teachers as the final authority on grades.',
    'The purpose of peer feedback is to distribute marking work without changing how students learn.',
    'Students benefit most from receiving large quantities of comments immediately before submission.',
    'Clear criteria, specific respectful comments and time for revision allow peer feedback to develop judgement and improve learning alongside teacher assessment.'
  ],3,'Peer review is a learning cycle that develops judgement; clear criteria and opportunities to revise matter more than simply distributing marking.')
];
const singles = [
  choice('lmcsa','sst-repair-cafes','How should the success of a community repair workshop be judged?',[
    'Only by how many items work briefly at the end.','By replacing all professional repair services.','By both useful repairs and learning outcomes.','By accepting every repair regardless of safety.'
  ],2,'The speaker includes learning, confidence and community benefits alongside useful, safe repairs.'),
  choice('lmcsa','sst-forecast-uncertainty','Why does a changed weather forecast not necessarily indicate careless work?',[
    'New observations can alter the evidence available.','The chance and amount of rain are identical.','Forecasts are intended only for event organisers.','A forecast promises certainty for every location.'
  ],0,'Forecasts use the evidence available at a particular time and are updated when new observations arrive.'),
  choice('lmcsa','sst-shared-workspaces','What is the main aim of successful workspace design?',[
    'Making every room available only to senior employees.','Removing all quiet areas to increase conversation.','Improving appearance without consulting staff.','Supporting both individual concentration and cooperation.'
  ],3,'The speaker recommends spaces and shared expectations that balance focus with collaboration.'),
  choice('lmcsa','pred26-sst-01','According to the speaker, what gives an innovative idea lasting value?',[
    'Being unusual even when it solves no problem.','Purposeful improvement combined with reliable execution.','Avoiding customer feedback after launch.','Copying existing products without modification.'
  ],1,'Usefulness, testing, execution and continuing improvement matter alongside novelty.'),
  choice('lmcsa','pred26-sst-02','Why should managers continue learning beyond their immediate field?',[
    'To replace all practical experience with theory.','To avoid having to explain difficult decisions.','To broaden their perspectives and adapt their decisions.','To apply the same habits in every situation.'
  ],2,'Continuing education connects experience with broader ideas and supports adaptation to different situations.'),
  choice('lmcsa','pred26-sst-03','Which emotional state does the speaker recommend?',[
    'Calm satisfaction combined with a moderate level of challenge.','Constant excitement and repeated extreme highs.','Contentment that excludes ambition or effort.','Allowing temporary feelings to determine every decision.'
  ],0,'The speaker recommends emotional balance, where contentment can coexist with challenge, ambition and effort.')
];
function blanks(id, words) {
  const q=source(id); let passage=q.text;
  words.forEach((word,i)=>{
    const at=passage.indexOf(word);
    if(at<0)throw Error('Missing blank '+word+' in '+id);
    passage=passage.slice(0,at)+'[['+(i+1)+']]'+passage.slice(at+word.length);
  });
  return {id:'listen-lfi-'+id,type:'lfi',audioId:id,title:q.title,text:q.text,passage,answers:words,
    prompt:'Listen and type the missing words in the transcript.',explanation:'Each blank must match the word spoken in the recording, with correct spelling.'};
}
const fill = [
  blanks('pred26-sst-04',['context','survival','preference','recognition','communication']),
  blanks('pred26-sst-05',['surface','appropriate','packaged','handling','equipment']),
  blanks('pred26-sst-06',['evidence','fairness','informed','communities','transparent']),
  blanks('pred26-sst-07',['potential','decisions','attention','exaggerate','judgement']),
  blanks('pred26-sst-08',['congestion','investment','immediate','retraining','regional']),
  blanks('pred26-sst-09',['frequent','individual','subscription','eligibility','convenience'])
];
function incorrect(id, changes) {
  const q=source(id), tokens=q.text.split(/\s+/), answers=[];
  for(const [from,to] of changes) {
    const i=tokens.findIndex((word,index)=>!answers.includes(index)&&word.replace(/[^\p{L}]/gu,'').toLowerCase()===from);
    if(i<0)throw Error('Missing incorrect-word source '+from+' in '+id);
    tokens[i]=tokens[i].replace(new RegExp(from,'i'),to);answers.push(i);
  }
  return {id:'listen-hiw-'+id,type:'hiw',audioId:id,title:q.title,text:q.text,passage:tokens.join(' '),answers,
    prompt:'Click the words in the transcript that differ from the recording.',explanation:'Compare the highlighted transcript words with the original recording. Correct selections gain one point; incorrect selections lose one point, with a minimum of zero.'};
}
const highlight = [
  incorrect('pred26-sst-10',[['internally','internationally'],['reward','replace'],['widen','reduce'],['transparent','temporary']]),
  incorrect('pred26-sst-11',[['communication','competition'],['storage','shortage'],['risks','rewards'],['responsible','expensive']]),
  incorrect('pred26-sst-12',[['independently','immediately'],['safety','salary'],['uncertainty','opportunity'],['accessible','acceptable']]),
  incorrect('pred26-sst-13',[['growth','wealth'],['culture','climate'],['economic','academic'],['respect','comfort']]),
  incorrect('pred26-sst-14',[['process','protect'],['education','production'],['privacy','priority'],['accountability','availability']]),
  incorrect('pred26-sst-15',[['discouraging','encouraging'],['evidence','confidence'],['revising','reviewing'],['unchanged','unpublished']])
];
const missing = [
  {id:'listen-smw-1',type:'smw',title:'Evaluating a campus energy trial',
    text:'A university installed energy displays in several student residences. During the first month, electricity use fell noticeably, but the researchers did not immediately attribute the reduction to the screens. Some students had left for a holiday, and the weather had become milder. To judge whether the displays changed behaviour, the team needed to compare similar buildings over the same period. Otherwise, a seasonal change might be mistaken for',
    choices:['a technical failure','a successful intervention','a rise in energy demand','a shortage of accommodation'],answer:1,
    explanation:'The speaker warns that a reduction caused by holidays or weather could be wrongly attributed to the displays. The missing ending is “a successful intervention”.'},
  {id:'listen-smw-2',type:'smw',title:'Understanding a survey sample',
    text:'A city council asked residents to complete an online survey about local parks. Many responses praised facilities near the centre, but the council noticed that few participants lived in the outer suburbs. Simply collecting more replies through the same website would not necessarily solve this imbalance. The team therefore arranged interviews in libraries and community centres across the city. Their purpose was to include people who had previously been',
    choices:['responsible for the survey','satisfied with every park','employed by the council','underrepresented in the sample'],answer:3,
    explanation:'The interviews address the low participation of outer-suburb residents, who were underrepresented in the original sample.'},
  {id:'listen-smw-3',type:'smw',title:'Learning from a failed prototype',
    text:'An engineering team built a small model of a bridge before approving the final design. When the model bent under a heavy load, the team did not regard the experiment as wasted effort. Sensors showed exactly where the structure was weakest, allowing the engineers to change the supports before construction began. Testing at this early stage was useful because a problem discovered in a model is usually easier and cheaper to correct than',
    choices:['one discovered in the completed structure','a prediction made before testing','one discussed in a classroom','a delay in ordering equipment'],answer:0,
    explanation:'Early testing allows weaknesses to be corrected before construction, when correction would be more difficult and expensive.'}
].map(q=>({...q,audioMode:'runtime-neural',ttsModel:'tts-1-hd',voice:'nova',audioSpeed:0.95,audioEndCue:true,
  prompt:'The recording ends with a beep. Select the missing words that best complete it.'}));
const sstIds=['wm1-sst','pred26-sst-16','pred26-sst-17'];
const dictation=bank.dictation;
const mocks=Array.from({length:3},(_,i)=>{
  const sst={...source(sstIds[i]),minutes:10};
  const rest=[...multiple.slice(i*2,i*2+2),...fill.slice(i*2,i*2+2),...summaries.slice(i*2,i*2+2),
    ...singles.slice(i*2,i*2+2),missing[i],...highlight.slice(i*2,i*2+2),...dictation.slice(i*3,i*3+3)]
    .map(q=>({...structuredClone(q),minutes:25,timeGroup:'listening'}));
  return {id:'listening-mock-'+(i+1),title:'Listening Sectional Mock '+(i+1),module:'listening',questions:[sst,...rest]};
});
module.exports={mocks,missing,listeningFormat};
