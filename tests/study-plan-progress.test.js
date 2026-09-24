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

test('writing lab presents estimate scores without native mark totals', () => {
  assert.match(writingClient, /<h2>Practice estimate<\/h2>/);
  assert.match(writingClient, /summary\.score90/);
  assert.match(writingClient, /Estimate '\+report\.score90\(r\.total,r\.maximum\)\+'\/90/);
  assert.doesNotMatch(writingClient, /Native practice result/);
  assert.doesNotMatch(writingClient, /Task marks are shown first/);
  assert.doesNotMatch(writingClient, /<th>Marks<\/th>/);
});
