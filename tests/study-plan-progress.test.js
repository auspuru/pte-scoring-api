'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const indexSource = fs.readFileSync(require.resolve('../public/index'), 'utf8');
const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
const writingClient = fs.readFileSync(require.resolve('../public/writing-lab-client'), 'utf8');
const server = fs.readFileSync(require.resolve('../server'), 'utf8');

test('study targets are editable, synced and used by Today’s plan', () => {
  assert.match(html, /id="todayPlanCard"/);
  assert.match(html, /id="studyTargetScore"/);
  assert.match(html, /id="studyTestDate"/);
  assert.match(html, /id="studyWeeklyFrequency"/);
  assert.match(indexSource, /studyPlan: data\.studyPlan/);
  assert.match(indexSource, /studyPlan: userProfile\?\.studyPlan/);
  assert.match(indexSource, /function renderTodayPlan\(\)/);
  assert.match(indexSource, /Based on your saved practice results/);
  assert.match(indexSource, /Complete two scored practices/);
  assert.match(server, /studyPlan: u\.studyPlan \|\| \{\}/);
  assert.match(server, /incoming\.studyPlan\?\.updatedAt/);
});

test('My Progress derives a weakest area only from comparable saved native results', () => {
  const source = fs.readFileSync(require.resolve('../public/student-progress'), 'utf8');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const model = ctx.StudentProgress.model({
    reading: { history: [] },
    swt: {},
    essays: [
      { date: 1, scores: { total: 13 } },
      { date: 2, scores: { total: 15 } }
    ]
  }, [
    { kind: 'sst', status: 'submitted', total: 10, maximum: 12, startedAt: 3 },
    { kind: 'sst', status: 'submitted', total: 11, maximum: 12, startedAt: 4 },
    { kind: 'wfd', status: 'submitted', total: 9, maximum: 10, startedAt: 5 },
    { kind: 'wfd', status: 'submitted', total: 10, maximum: 10, startedAt: 6 }
  ]);
  assert.equal(model.weakest.name, 'Write Essay');
  assert.equal(model.weakest.count, 2);
  assert(model.weakest.average < 0.6);
  assert.equal(model.areas.find(a => a.name === 'Summarise Spoken Text').count, 2);
});


test('My Progress trends combine normal practice and matching mock task results', () => {
  const source = fs.readFileSync(require.resolve('../public/student-progress'), 'utf8');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const model = ctx.StudentProgress.model({
    reading: { history: [
      { id:'reading-1', practiceUid:'dropdown:1', done:true, earned:1, possible:4, questions:[{type:'dropdown'}], startedAt:10, finishedAt:10 },
      { id:'mock-reading', done:true, percent:75, startedAt:15, finishedAt:15, rows:[
        {type:'dropdown',earned:4,possible:4,gradedPossible:4,pending:0},
        {type:'swt',earned:8,possible:9,gradedPossible:9,pending:0},
        {type:'hiw',earned:3,possible:4,gradedPossible:4,pending:0}
      ] },
      { id:'reading-2', practiceUid:'dropdown:2', done:true, earned:3, possible:4, questions:[{type:'dropdown'}], startedAt:20, finishedAt:20 },
      { id:'listening-1', practiceUid:'hiw:1', done:true, earned:2, possible:4, questions:[{type:'hiw'}], startedAt:25, finishedAt:25 }
    ] },
    swt: {
      1: [{ timestamp:1, overall_score:55, trait_scores:{content:1,form:1,grammar:1,vocabulary:2} }],
      2: [{ timestamp:2, overall_score:88, trait_scores:{content:3,form:1,grammar:2,vocabulary:2} }]
    },
    essays: [
      { date:3, scores:{total:13} },
      { date:4, scores:{total:20} }
    ]
  }, [
    { id:'sst-1', kind:'sst', status:'submitted', total:6, maximum:12, startedAt:30 },
    { id:'sst-2', kind:'sst', status:'submitted', total:10, maximum:12, startedAt:40 },
    { id:'wfd-1', kind:'wfd', status:'submitted', total:4, maximum:10, startedAt:50 },
    { id:'wfd-2', kind:'wfd', status:'submitted', total:8, maximum:10, startedAt:60 },
    { id:'mock-writing', kind:'mock', status:'submitted', total:76, maximum:86, startedAt:70, title:'Writing mock', byType:[
      {type:'swt',count:2,marked:2,total:15,maximum:18},
      {type:'essay',count:1,marked:1,total:22,maximum:26},
      {type:'sst',count:1,marked:1,total:11,maximum:12},
      {type:'wfd',count:3,marked:3,total:28,maximum:30}
    ] }
  ], [
    { id:'ra-1', type:'ra', status:'submitted', startedAt:80, result:{total:2,maximum:3} },
    { id:'ra-2', type:'ra', status:'submitted', startedAt:90, result:{total:3,maximum:3} },
    { id:'rs-draft', type:'rs', status:'draft', startedAt:100, result:null }
  ]);
  const area = name => model.areas.find(a => a.name === name);
  assert.equal(area('Summarise Written Text').count, 4);
  assert.equal(area('Summarise Written Text').practiceCount, 2);
  assert.equal(area('Summarise Written Text').mockCount, 2);
  assert.equal(area('Write Essay').count, 3);
  assert.equal(area('Write Essay').mockCount, 1);
  assert.equal(area('Reading Blanks (Dropdown)').count, 3);
  assert.equal(area('Reading Blanks (Dropdown)').practiceCount, 2);
  assert.equal(area('Reading Blanks (Dropdown)').mockCount, 1);
  assert.equal(area('Highlight Incorrect Words').count, 2);
  assert.equal(area('Highlight Incorrect Words').mockCount, 1);
  assert.equal(area('Read Aloud').count, 2);
  assert.equal(area('Read Aloud').mockCount, 0);
  assert.equal(area('Summarise Spoken Text').count, 3);
  assert.equal(area('Write From Dictation').count, 3);
  assert.equal(model.practice, 13, 'Practice attempts card remains standalone-practice activity');
  assert.equal(model.complete, 2, 'Mocks remain reviewable in the separate mock section');
  assert.match(source, /combine normal practice with matching per-task mock results/);
  assert.match(source, /practiceCount/);
  assert.match(source, /mockCount/);
});

test('My Progress surfaces recent completed SWT and Essay attempts near the top', () => {
  const source = fs.readFileSync(require.resolve('../public/student-progress'), 'utf8');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const model = ctx.StudentProgress.model({
    reading:{history:[]},
    swt:{3:[{timestamp:'2026-09-30T10:05:00.000Z',overall_score:82}]},
    swtDrafts:{},
    essays:[],
    essayDraft:null
  }, [], []);
  model.recentWriting.push({
    engine:'essay',title:'Write Essay',route:'practice',at:'2026-09-30T10:06:00.000Z',detail:'Completed · 22/26'
  });
  assert(model.recentWriting.some(item => item.title === 'Summarise Written Text' && /82\/90/.test(item.detail)));
  assert.match(source, /Recent writing activity/);
  assert(source.indexOf('Recent writing activity') < source.indexOf('Currently in progress'));
});

test('My Progress exposes saved in-progress practice from another device', () => {
  const source = fs.readFileSync(require.resolve('../public/student-progress'), 'utf8');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const model = ctx.StudentProgress.model({
    reading: {
      session: {
        id:'reading-live',
        practiceUid:'dropdown:live',
        done:false,
        index:0,
        questions:[{uid:'dropdown:live',type:'dropdown'}],
        answers:{'dropdown:live':['']},
        times:{},
        startedAt:100,
        updatedAt:200
      },
      history:[]
    },
    swt:{},
    swtDrafts:{
      7:{text:'A saved SWT draft still being written',timestamp:'1970-01-01T00:00:00.250Z'}
    },
    essays:[],
    essayDraft:{
      version:1,essayText:'An unfinished essay response',questionText:'Discuss the issue.',
      questionTitle:'Essay draft topic',updatedAt:350
    }
  }, [
    { id:'sst-live', kind:'sst', status:'active', title:'SST live', startedAt:300, completed:0, questions:1 }
  ], [
    { id:'ra-live', type:'ra', status:'draft', startedAt:400, result:null }
  ]);
  assert.equal(model.activePractice.length, 5);
  assert.equal(model.activePractice[0].title, 'Read Aloud');
  assert(model.activePractice.some(item => item.title === 'Summarise Written Text' && /words saved/.test(item.detail)));
  assert(model.activePractice.some(item => item.title === 'Write Essay' && /Essay draft topic/.test(item.detail)));
  assert(model.recent.some(item => item.result && item.result.startsWith('In progress')));
  assert.match(source, /Currently in progress/);
  assert.match(source, /In-progress practice is shown as soon as it reaches your account/);
});

test('My Progress includes completed essay practice in recent writing', () => {
  const source = fs.readFileSync(require.resolve('../public/student-progress'), 'utf8');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const model = ctx.StudentProgress.model({
    reading:{history:[]},swt:{},swtDrafts:{},essays:[],essayDraft:null
  }, [], []);
  const essayModel = ctx.StudentProgress.model({
    reading:{history:[]},swt:{},swtDrafts:{},
    essays:[{id:'essay-1',questionTitle:'Technology essay',date:Date.parse('2026-09-30T10:06:00.000Z'),scores:{total:22}}],
    essayDraft:null
  }, [], []);
  assert.equal(model.recentWriting.length, 0);
  assert(essayModel.recentWriting.some(item => item.title === 'Technology essay' && item.detail === 'Completed · 22/26'));
});

test('My Progress does not relabel an already-scored SWT answer as an unfinished draft', () => {
  const source = fs.readFileSync(require.resolve('../public/student-progress'), 'utf8');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const model = ctx.StudentProgress.model({
    reading:{history:[]},
    swt:{4:[{timestamp:'2026-09-30T10:01:00.000Z',overall_score:79}]},
    swtDrafts:{4:{text:'The answer that was already scored',timestamp:'2026-09-30T10:00:00.000Z'}},
    essays:[]
  }, [], []);
  assert.equal(model.activePractice.some(item => item.engine === 'swt'), false);
});

test('My Progress forces a fresh cloud pull instead of relying on the background throttle', () => {
  assert.match(indexSource, /refreshPracticeHistory\(\{ force: true \}\)/);
  assert.match(indexSource, /My Progress is an observation surface/);
  assert.match(html, /student-progress\.js\?v=20260930-writing-drafts/);
});

test('writing lab presents estimate scores without native mark totals', () => {
  assert.match(writingClient, /<h2>Practice estimate<\/h2>/);
  assert.match(writingClient, /summary\.score90/);
  assert.match(writingClient, /Estimate '\+report\.score90\(r\.total,r\.maximum\)\+'\/90/);
  assert.doesNotMatch(writingClient, /Native practice result/);
  assert.doesNotMatch(writingClient, /Task marks are shown first/);
  assert.doesNotMatch(writingClient, /<th>Marks<\/th>/);
});


test('My Progress ignores pending feedback and calculates newest-first API results chronologically', () => {
  const source = fs.readFileSync(require.resolve('../public/student-progress'), 'utf8');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const model = ctx.StudentProgress.model({ reading: { history: [] }, swt: {}, essays: [] }, [
    { kind: 'sst', status: 'submitted', total: null, maximum: 12, startedAt: 30 },
    { kind: 'sst', status: 'submitted', total: 10, maximum: 12, startedAt: 20 },
    { kind: 'sst', status: 'submitted', total: 6, maximum: 12, startedAt: 10 }
  ]);
  const sst = model.areas.find(a => a.name === 'Summarise Spoken Text');
  assert.equal(sst.count, 2, 'pending feedback must not become a zero score');
  assert.equal(sst.trend.label, 'Improving');
  assert.equal(sst.trend.delta, 33);
});
