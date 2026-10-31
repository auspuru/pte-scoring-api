'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../public/index.js'),'utf8');
const navigation=source.slice(source.indexOf('function saveEssayQuestionDraft('),source.indexOf('function renderPracticeMain()'));
test('Essay navigation restores separate drafts and blocks a move when saving fails',()=>{
 const data={},ctx={essays:[{id:'a',question:'First question'},{id:'b',question:'Second question'}],practiceSubmissionPending:false,
 practiceState:{view:'write',questionSource:'library',selectedQuestionId:'a',essayText:'First draft',timerStartedAt:123},
 document:{getElementById:()=>null},stopLoadingMessages(){},startLoadingMessages(){},getPteStorageKey:k=>'alice:'+k,LocalStore:{get:k=>data[k]?JSON.parse(data[k]):null},safeLSSet:(k,v)=>{data[k]=v;return true;},stopPracticeTimer(){},renderPracticeMain(){},toast(){}};
 vm.createContext(ctx);vm.runInContext(navigation,ctx);
 ctx.moveEssayQuestion(1);assert.equal(ctx.practiceState.selectedQuestionId,'b');assert.equal(ctx.practiceState.essayText,'');
 ctx.practiceState.essayText='Second draft';ctx.moveEssayQuestion(-1);assert.equal(ctx.practiceState.essayText,'First draft');assert.equal(ctx.practiceState.timerStartedAt,123);
 ctx.safeLSSet=()=>false;ctx.moveEssayQuestion(1);assert.equal(ctx.practiceState.selectedQuestionId,'a');assert.equal(ctx.practiceState.essayText,'First draft');
});

test('SWT Back/Next respect attempted filters and stop at each filtered boundary',()=>{
 const script=source.slice(source.indexOf('function swtNavigationPositions('),source.indexOf('function switchWriteTab('));
 const disabled={},jumps=[];
 const ctx={passages:[{id:1},{id:2},{id:3},{id:4}],attempted:new Set([2,4]),activeFilter:'attempted',currentPassageId:2,
 document:{getElementById:id=>({toggleAttribute:(name,value)=>disabled[id]=value,focus(){}})},jumpToPassage:id=>{jumps.push(id);ctx.currentPassageId=id;}};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 ctx.updateSwtPracticeNavigation();assert.equal(disabled.navPrev,true);assert.equal(disabled.navNext,false);
 ctx.nextPassage();assert.deepEqual(jumps,[4]);ctx.updateSwtPracticeNavigation();assert.equal(disabled.navNext,true);
 ctx.nextPassage();assert.deepEqual(jumps,[4]);ctx.prevPassage();assert.deepEqual(jumps,[4,2]);
 ctx.activeFilter='unattempted';ctx.currentPassageId=1;ctx.nextPassage();assert.equal(ctx.currentPassageId,3);
 ctx.activeFilter='attempted';ctx.attempted.clear();ctx.updateSwtPracticeNavigation();assert.equal(disabled.navPrev,true);assert.equal(disabled.navNext,true);
});

test('SWT priority passages use visual positions but save and grade by stable database ID', () => {
 const helper=source.slice(source.indexOf('const swtPassageAt ='),source.indexOf('let swtResultPassage ='));
 assert(helper.includes('swtPassageStorageId'));
 const context={passages:[{id:910498,title:'Origin of Species'},{id:910108,title:'Working Nine to Five'},{id:1,title:'Original first question'}],currentPassageId:1};
 vm.createContext(context);
 const ids=vm.runInContext(helper+'; [swtPassageAt(1).title,swtPassageStorageId(),swtPassageStorageId(2),swtPassageStorageId(3)]',context);
 assert.deepEqual([...ids],['Origin of Species',910498,910108,1]);
 assert.match(source,/const p = swtPassageAt\(id\);/);
 assert.match(source,/loadSwtHighlightExercise\(p\.id\);/);
 assert.match(source,/const passageId = p\?\.id;/);
 assert.match(source,/summaryInputEl\.value = \(summaries\[p\.id\]/);
 assert.match(source,/scores\[swtPassageStorageId\(\)\]/);
});


test('Essay navigation leaves a pending review attached to its question and Back returns to its picker',()=>{
 const data={},ctx={essays:[{id:'a',question:'First question'},{id:'b',question:'Second question'}],practiceSubmissionPending:true,
 practiceState:{view:'loading',questionSource:'library',selectedQuestionId:'a',essayText:'Saved answer',submissionId:'review-a'},
 submitPracticeEssay:Object.assign(()=>{},{jobs:new Map([['review-a',{}]])}),document:{getElementById:()=>null},
 getPteStorageKey:k=>k,LocalStore:{get:k=>data[k]?JSON.parse(data[k]):null},safeLSSet:(k,v)=>{data[k]=v;return true;},
 stopPracticeTimer(){},stopLoadingMessages(){},startLoadingMessages(){},renderPracticeMain(){},toast(){}};
 vm.createContext(ctx);vm.runInContext(navigation,ctx);
 assert.match(ctx.essayQuestionNavigation(),/Next/);ctx.moveEssayQuestion(1);assert.equal(ctx.practiceState.selectedQuestionId,'b');
 ctx.moveEssayQuestion(-1);assert.equal(ctx.practiceState.view,'loading');assert.equal(ctx.practiceState.essayText,'Saved answer');
 ctx.submitPracticeEssay.jobs.clear();ctx.moveEssayQuestion(1);ctx.moveEssayQuestion(-1);assert.equal(ctx.practiceState.view,'write');
 ctx.practiceState.view='results';ctx.backToEssayQuestions();assert.equal(ctx.practiceState.view,'write');assert.equal(ctx.practiceState.writeStep,1);
 assert.match(source,/onclick="backToEssayQuestions\(\)">← Back to essays/);
});


test('SWT assignments resolve stable IDs after priority ordering and retain the current question for unavailable IDs',()=>{
 const loaded=[],notices=[],ctx={passages:[{id:910498},{id:1}],switchSection(){},setSwtPracticeMode(){},showSwtScreen(){},loadPassage:id=>loaded.push(id),toast:text=>notices.push(text)};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function launchAssignedQuestion('),source.indexOf('let speakingAccessUser')),ctx);
 ctx.launchAssignedQuestion({engine:'swt',passageId:1});assert.deepEqual(loaded,[2]);
 ctx.launchAssignedQuestion({engine:'swt',passageId:910498});assert.deepEqual(loaded,[2,1]);
 ctx.launchAssignedQuestion({engine:'swt',passageId:'missing'});assert.deepEqual(loaded,[2,1]);assert.equal(notices.length,1);
});
