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
