'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const puppeteer = require('puppeteer');
const run = require('node:util').promisify(require('node:child_process').execFile);
const { database, until } = require('./helpers/full-mock-systems');
const { loadPaper } = require('../full-mock/paper');
const { installFullMock } = require('../full-mock/api');
const adapters = require('../full-mock/adapters');
const paper = loadPaper(), root = path.resolve(__dirname, '..');
async function fixture(t, mobile) {
  const db = await database(t), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'full-mock-browser-'));
  const source = paper.questions.find(candidate => candidate.question.type === 'rs').audio.path, microphone = path.join(directory, 'microphone.wav');
  await run('ffmpeg', ['-hide_banner','-loglevel','error','-nostdin','-y','-i',path.join(root, source),'-ar','48000','-ac','1','-c:a','pcm_s16le',microphone]);
  let offset = 0; const now = () => Date.now() + offset, calls = new Map(), native = adapters.createAdapters();
  const app = express(); app.use(express.json());
  const service = installFullMock(app, { pool:db.first, now, verifyToken:token => ['alice','student'].includes(token) ? token : null, getAccount:async uid => ({ username:uid,role:'user' }),
    canPreview:require('../full-mock/access').createPreviewAccess({all:true}),
    assessment:{ adapters:{ assess:async (q, response, options) => {
      calls.set(q.id, (calls.get(q.id) || 0) + 1);
      if (adapters.SPOKEN.has(q.type) && !options.recording || !adapters.SPOKEN.has(q.type) && !['swt','essay','sst'].includes(q.type)) return native.assess(q, response, options);
      return adapters.result(q, adapters.maxima(q)); // Paid assessments are injected, never called.
    } } } });
  await service.store.initialise();
  app.use(express.static(path.join(root, 'public'), { index:false }));
  app.get('/', (req, res) => res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/portal-workspace.css"><link rel="stylesheet" href="/full-mock.css"></head><body style="margin:0"><main id="appShell"><section id="fullMockPane" class="pane active"></section></main><script>window.currentUserId="alice";sessionStorage.setItem("pte_session_token","alice");</script><script src="/portal-exam-mode.js"></script><script src="/full-mock-report.js"></script><script src="/full-mock-client.js"></script><script>FullMock.open();</script></body></html>'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  let browser;
  db.onClose(async () => { await browser?.close(); await service.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive:true, force:true }); });
  browser = await puppeteer.launch({ headless:true, ...(process.env.FULL_MOCK_TEST_CHROME_PATH ? { executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH } : {}),
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture=' + microphone] });
  t.diagnostic('Browser: ' + await browser.version() + '; sandbox enabled; synthetic microphone; ' + (mobile ? 'mobile emulation' : 'desktop'));
  const page = await browser.newPage(); await page.setViewport(mobile ? { width:390, height:844, isMobile:true, hasTouch:true, deviceScaleFactor:1 } : { width:1365, height:1000 });
  page.setDefaultTimeout(15000); const unexpectedDialogs = [];
  page.on('dialog', dialog => { unexpectedDialogs.push(dialog.message()); return dialog.dismiss(); });
  const errors = [], apiErrors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('/api/full-mocks/')) apiErrors.push(response.status() + ' ' + new URL(response.url()).pathname); });
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('blob:') || request.url().startsWith('data:')) request.continue(); else request.abort(); });
  await page.evaluateOnNewDocument(() => { window.__cues = 0; const create = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function (...args) { window.__cues++; return create.apply(this, args); }; });
  await page.goto('http://127.0.0.1:' + server.address().port);
  const state = async () => (await service.store.list('alice'))[0];
  return { page, service, errors, apiErrors, unexpectedDialogs, calls, state, advanceTo:at => { offset += Math.max(0, at - now()); } };
}
async function clickControl(page, selector) {
  await page.$eval(selector, node => node.scrollIntoView({ block:'center', inline:'nearest' }));
  await page.waitForFunction(selector => { const node = document.querySelector(selector); if (!node) return false; const box = node.getBoundingClientRect(), target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return node === target || node.contains(target); }, {}, selector);
  if (page.viewport()?.hasTouch) await page.tap(selector); else await page.click(selector);
}
async function paste(page, selector, text) { await page.$eval(selector, (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles:true })); }, text); }
async function answer(page, q) {
  if (['swt','essay','sst','wfd'].includes(q.type)) { const text = q.type === 'wfd' ? q.text : q.sample || 'The response addresses the task with a clear position and relevant supporting reasons.'; await paste(page, '#fm-text', text); return [text]; }
  if (['dropdown','wordbank'].includes(q.type)) { for (let i = 0; i < q.answers.length; i++) await page.select('[data-fm-answer="' + i + '"]', q.answers[i]); return q.answers; }
  if (q.type === 'lfi') { for (let i = 0; i < q.answers.length; i++) await paste(page, '[data-fm-answer="' + i + '"]', q.answers[i]); return q.answers; }
  if (q.type === 'reorder') {
    for (let target = 0; target < q.answers.length; target++) {
      for (let moves = 0; moves < q.items.length; moves++) {
        const index = await page.$$eval('[data-fm-box]', (nodes, key) => nodes.findIndex(node => node.dataset.fmBox === key), q.answers[target]);
        if (index === target) break;
        await clickControl(page, '[data-fm-box="' + q.answers[target] + '"] [data-fm="up"]');
      }
    }
    return q.answers;
  }
  const values = q.answers || [q.answer];
  for (const value of values) await clickControl(page, q.type === 'hiw' ? '[data-fm="highlight"][data-index="' + value + '"]' : '[data-fm-choice="' + value + '"]');
  return q.type === 'hiw' ? values : [...values].sort((a, b) => a - b);
}
for (const mobile of [false,true]) test('Chrome ' + (mobile ? 'mobile emulation' : 'desktop') + ': native recording, all 22 forms, refresh recovery and submitted report', { timeout:240000 }, async t => {
  const f = await fixture(t, mobile), { page } = f;
  let expectedIndex = 0;
  try {
  await page.waitForSelector('[data-fm="setup"]'); assert(!await page.$eval('.fm-shell',node=>/preview/i.test(node.textContent))); await page.click('[data-fm="setup"]');
  await page.click('[data-fm="sample"]'); await page.waitForSelector('#fm-sample audio');
  await page.click('#fm-sample audio', { offset:{ x:20, y:25 } });
  await page.waitForFunction(() => document.querySelector('#fm-sample audio').currentTime > 0);
  await page.click('#fm-heard'); await page.waitForFunction(() => !document.getElementById('fm-begin').disabled); await page.click('#fm-begin');
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await page.waitForSelector('[data-fm="skip"]'); await page.click('[data-fm="skip"]');
  const expected = new Map(), seen = new Set(); let attemptId, readingDeadline, listeningDeadline;
  for (let i = 0; i < paper.questions.length; i++) {
    const q = paper.questions[i].question;
    expectedIndex = i + 1;
    if (!seen.has(q.type)) t.diagnostic('Entering ' + q.type + ' at question ' + expectedIndex);
    await page.waitForFunction(number => document.querySelector('.fm-exam-meta')?.textContent.includes('Question ' + number + ' of 65'), {}, i + 1);
    const saved = await f.state(); attemptId = saved.id; assert.equal(saved.index, i + 1); seen.add(q.type);
    assert(await page.evaluate(() => document.fullscreenElement === document.documentElement && document.getElementById('portal-exam-guard').hidden), 'Fullscreen was lost between questions');
    assert(!await page.$eval('.fm-exam-header', node => /preview/i.test(node.textContent)));
    if (!mobile && i === 0) {
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForSelector('#portal-exam-guard:not([hidden])');
      assert(await page.$eval('#fullMockPane',node=>node.inert));
      await clickControl(page,'#portal-exam-guard .portal-button.primary');
      await page.waitForFunction(()=>document.fullscreenElement===document.documentElement&&document.getElementById('portal-exam-guard').hidden);
      assert.equal((await f.state()).current.endsAt,saved.current.endsAt);
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflow at ' + q.type);
    if (q.type === 'dropdown') { readingDeadline ||= saved.current.endsAt; assert.equal(saved.current.endsAt, readingDeadline); }
    if (['lmcma','lfi','hcs','lmcsa','smw','hiw','wfd'].includes(q.type)) { listeningDeadline ||= saved.current.endsAt; assert.equal(saved.current.endsAt, listeningDeadline); }
    if (adapters.SPOKEN.has(q.type)) {
      if (q.id === 'fm1-ra-01' || q.id === 'fm1-rs-01') {
        if (q.type === 'rs') { f.advanceTo(saved.current.promptAt + 100); await page.waitForFunction(() => /Playing/.test(document.getElementById('fm-audio-status')?.textContent)); await page.waitForFunction(() => /Audio completed/.test(document.getElementById('fm-audio-status')?.textContent)); }
        else f.advanceTo(saved.current.responseAt - 2000);
        await page.waitForFunction(() => document.getElementById('fm-record-status')?.textContent === 'Recording');
        await until(async () => (await f.state()).responses[i + 1].segments.some(segment => Object.values(segment.chunks).some(chunk => chunk.stored)), 'Native MediaRecorder did not upload audio.');
        if (q.type === 'rs') assert(await page.evaluate(() => window.__cues > 0), 'Start cue was not produced before the speaking response');
        await clickControl(page, '[data-fm="next"]');
      } else await clickControl(page, '[data-fm="skip"]');
    } else {
      const response = await answer(page, q); expected.set(i + 1, response);
      if (q.type === 'swt' && !mobile && ![...expected.keys()].some(index => index !== i + 1 && paper.questions[index - 1].question.type === 'swt')) {
        await page.setOfflineMode(true); await paste(page, '#fm-text', response[0] + ' Saved while offline.'); expected.set(i + 1, [response[0] + ' Saved while offline.']);
        await until(async () => page.evaluate(() => new Promise(resolve => { const open = indexedDB.open('ipt-full-mock-v1', 1); open.onsuccess = () => { const db = open.result, read = db.transaction('pending').objectStore('pending').getAll(); read.onsuccess = () => { resolve(read.result.some(row => row.value.kind === 'draft')); db.close(); }; }; })), 'Offline draft was not saved to IndexedDB.');
        await page.setOfflineMode(false); await page.reload(); await page.waitForSelector('[data-fm="resume"]'); await page.click('[data-fm="resume"]');
        await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
        await page.waitForFunction(value => document.getElementById('fm-text')?.value === value, {}, expected.get(i + 1)[0]);
        assert.equal((await f.state()).current.endsAt, saved.current.endsAt);
      }
      await clickControl(page, '[data-fm="next"]');
    }
  }
  await page.waitForSelector('.fm-report-status'); await page.waitForFunction(() => /All 65/.test(document.querySelector('.fm-report-status')?.textContent), { timeout:30000 });
  assert(await page.evaluate(() => !document.fullscreenElement), 'Submitted report did not release fullscreen');
  assert(!await page.$eval('.fm-report-header',node=>/preview/i.test(node.textContent)));
  await f.service.assessor.drain(); const result = await f.service.assessor.results('alice', attemptId), saved = await f.state();
  assert.equal(seen.size, 22); assert.equal(result.ready, true); assert.equal(result.items.length, 65); assert.equal(result.profiles.overall.practiceIndex, null);
  for (const [index, response] of expected) assert.deepEqual(saved.responses[index].answer, response, 'Saved answer for Q' + index);
  assert.deepEqual(f.unexpectedDialogs, []);
  assert.equal(f.calls.size, 65); assert([...f.calls.values()].every(count => count === 1)); assert.equal(f.errors.length, 0, f.errors.join('; '));
  for (const type of ['ra','rs']) { const index = paper.questions.findIndex(row => row.question.type === type) + 1; assert(saved.responses[index].segments.some(segment => segment.finished && segment.chunkCount > 0)); }
  assert.equal(await page.$$eval('.fm-score-card', nodes => nodes.length), 5); assert.equal(await page.$$eval('#fm-review-select option', nodes => nodes.length), 65);
  await page.click('[data-fm="review-type"][data-type="di"]'); await page.click('[data-kind="image"]'); await page.waitForFunction(() => document.querySelector('#fm-review-image img')?.naturalWidth > 0);
  await page.click('[data-fm="review-type"][data-type="rs"]'); await page.click('[data-kind="prompt"]'); await page.waitForSelector('#fm-review-prompt audio');
  await page.click('[data-fm="review-type"][data-type="ra"]'); await page.click('[data-kind="recording"]'); await page.waitForSelector('#fm-review-detail audio');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Report overflows viewport');
  await page.reload(); await page.waitForSelector('[data-fm="resume"]'); await page.click('[data-fm="resume"]'); await page.waitForSelector('.fm-report-status');
  assert.equal((await f.service.assessor.results('alice', attemptId)).ready, true); assert([...f.calls.values()].every(count => count === 1));
  } catch (error) {
    const saved = await f.state();
    t.diagnostic('Expected Q' + expectedIndex + '; saved index=' + saved?.index + '; status=' + saved?.status + '; type=' + saved?.responses[saved?.index]?.type);
    t.diagnostic('Screen: ' + await page.$eval('#fullMockPane', node => node.textContent.slice(-2200)).catch(() => 'unavailable'));
    t.diagnostic('API errors: ' + f.apiErrors.slice(-12).join('; ')); t.diagnostic('Unexpected dialogs: ' + f.unexpectedDialogs.join('; ')); throw error;
  }
});
