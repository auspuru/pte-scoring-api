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

test('Writing mocks explain forward-only navigation once and submit Next without routine dialogs', () => {
  assert.match(writingClient, /Next locks each answer and you cannot return to an earlier question/);
  assert.doesNotMatch(writingClient, /attempt\.kind==='mock' && final && !await confirmAction/);
  assert.match(writingClient,/unanswered&&attempt\.kind!=='mock'&&!await confirmAction/);
  assert.doesNotMatch(writingClient, /final\?'Finish this attempt\?':'Submit this answer\?'/);
  assert.match(writingClient, /Leave this attempt\?/);
});

test('Reading checked practice offers a direct retry without changing scoring logic', () => {
  assert.match(reading, /data-action="retry-question">Retry this question/);
  assert.match(reading, /d\.action==='retry-question'&&s\.practiceUid/);
  assert.match(reading, /state\.drafts=\[s,/);
  assert.match(reading, /start\('practice',s\.practiceUid,true\)/);
  assert.equal(require('node:crypto').createHash('sha256').update(require('../public/reading-practice').score.toString()).digest('hex'),'3998d5c54514d46ffbfddf893667574bee7a06b729f01a1da4a74248962f629b');
});
