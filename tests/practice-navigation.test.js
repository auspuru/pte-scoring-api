'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../public/index.js'),'utf8');
const navigation=source.slice(source.indexOf('function essayQuestionNavigation()'),source.indexOf('function renderPracticeMain()'));
test('Essay navigation restores separate drafts and blocks a move when saving fails',()=>{
 const data={},ctx={essays:[{id:'a',question:'First question'},{id:'b',question:'Second question'}],practiceSubmissionPending:false,
 practiceState:{view:'write',questionSource:'library',selectedQuestionId:'a',essayText:'First draft',timerStartedAt:123},
 getPteStorageKey:k=>'alice:'+k,LocalStore:{get:k=>data[k]?JSON.parse(data[k]):null},safeLSSet:(k,v)=>{data[k]=v;return true;},stopPracticeTimer(){},renderPracticeMain(){},toast(){}};
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
