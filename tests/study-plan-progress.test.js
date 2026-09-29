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


test('My Progress includes normal Reading practice results in task trends', () => {
  const source = fs.readFileSync(require.resolve('../public/student-progress'), 'utf8');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const model = ctx.StudentProgress.model({
    reading: { history: [
      { id: 'practice-1', practiceUid: 'dropdown:1', done: true, earned: 1, possible: 4, startedAt: 1, finishedAt: 10 },
      { id: 'mock-1', done: true, earned: 10, possible: 10, percent: 100, startedAt: 15, finishedAt: 15 },
      { id: 'practice-2', practiceUid: 'dropdown:2', done: true, earned: 3, possible: 4, startedAt: 2, finishedAt: 20 }
    ] },
    swt: {},
    essays: []
  }, []);
  const reading = model.areas.find(a => a.name === 'Reading practice');
  assert.equal(reading.count, 2, 'normal practice attempts should feed Reading trends');
  assert.equal(reading.trend.label, 'Improving');
  assert.equal(reading.trend.delta, 50);
  assert.equal(model.complete, 1, 'mock history remains separate from individual practice trends');
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
