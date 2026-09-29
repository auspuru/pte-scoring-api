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


test('My Progress trends use standalone practice across SWT, Reading, Speaking, Essay and Listening', () => {
  const source = fs.readFileSync(require.resolve('../public/student-progress'), 'utf8');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const model = ctx.StudentProgress.model({
    reading: { history: [
      { id:'reading-1', practiceUid:'dropdown:1', done:true, earned:1, possible:4, questions:[{type:'dropdown'}], startedAt:10, finishedAt:10 },
      { id:'mock-reading', done:true, percent:100, earned:10, possible:10, questions:[{type:'dropdown'}], startedAt:15, finishedAt:15 },
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
    { id:'mock-writing', kind:'mock', status:'submitted', total:40, maximum:50, startedAt:70, title:'Writing mock' }
  ], [
    { id:'ra-1', type:'ra', status:'submitted', startedAt:80, result:{total:2,maximum:3} },
    { id:'ra-2', type:'ra', status:'submitted', startedAt:90, result:{total:3,maximum:3} },
    { id:'rs-draft', type:'rs', status:'draft', startedAt:100, result:null }
  ]);
  const area = name => model.areas.find(a => a.name === name);
  assert.equal(area('Summarise Written Text').count, 2);
  assert.equal(area('Summarise Written Text').trend.label, 'Improving');
  assert.equal(area('Reading Blanks (Dropdown)').count, 2);
  assert.equal(area('Reading Blanks (Dropdown)').trend.delta, 50);
  assert.equal(area('Highlight Incorrect Words').count, 1);
  assert.equal(area('Read Aloud').count, 2);
  assert.equal(area('Summarise Spoken Text').count, 2);
  assert.equal(area('Write From Dictation').count, 2);
  assert.equal(model.practice, 13, 'standalone practice count must exclude mocks and drafts');
  assert.equal(model.complete, 2, 'reading and writing mocks stay in the separate mock section');
  assert.match(source, /\/api\/speaking\/attempts/);
  assert.match(source, /Task trends use standalone practice results/);
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
