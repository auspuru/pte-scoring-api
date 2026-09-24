'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const portal = fs.readFileSync(require.resolve('../public/index'), 'utf8');
const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
const reading = fs.readFileSync(require.resolve('../public/reading-practice'), 'utf8');
const writingClient = fs.readFileSync(require.resolve('../public/writing-lab-client'), 'utf8');
const writingServer = fs.readFileSync(require.resolve('../writing-lab'), 'utf8');

test('Home resume is activity-aware and can reopen exact Reading or Writing attempt IDs', () => {
  assert.match(html, /id="portalResumeButton"/);
  assert.match(html, /onclick="resumePortalActivity\(\)"/);
  assert.match(portal, /function localPortalResumeCandidate\(\)/);
  assert.match(portal, /readingRequest:\{ attemptId:target\.id \}/);
  assert.match(portal, /labRequest:\{ attemptId:target\.id \}/);
  assert.match(portal, /\/api\/writing-lab\/attempts/);
  assert.match(writingServer, /index:current\.index/);
  assert.match(portal, /Continue your last activity/);
});

test('Writing mocks explain forward-only navigation once and confirm only final submission', () => {
  assert.match(writingClient, /Next locks each answer and you cannot return to an earlier question/);
  assert.match(writingClient, /attempt\.kind==='mock' && final && !await confirmAction/);
  assert.doesNotMatch(writingClient, /final\?'Finish this attempt\?':'Submit this answer\?'/);
  assert.match(writingClient, /Leave this attempt\?/);
});

test('Reading checked practice offers a direct retry without changing scoring logic', () => {
  assert.match(reading, /data-action="retry-question">Retry this question/);
  assert.match(reading, /d\.action==='retry-question'&&s\.practiceUid/);
  assert.match(reading, /s\.answers\[q\.uid\]=\[\]/);
  assert.match(reading, /s\.checked=s\.checked\.filter/);
});
