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
async function fixture(t, mobile, selectedPaper = paper) {
  const listening=selectedPaper.module==='listening';
  const db = await database(t), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'full-mock-browser-'));
  const source = selectedPaper.questions.find(candidate => candidate.question.type === 'rs').audio.path, microphone = path.join(directory, 'microphone.wav');
  await run('ffmpeg', ['-hide_banner','-loglevel','error','-nostdin','-y','-i',path.join(root, source),'-ar','48000','-ac','1','-c:a','pcm_s16le',microphone]);
  let offset = 0; const now = () => Date.now() + offset, calls = new Map(), native = adapters.createAdapters();
  const app = express(); app.use(express.json());
  const service = installFullMock(app, { pool:db.first, now, ...(listening?{variant:'listening',paper:selectedPaper,papers:[selectedPaper],legacyAttempts:async()=>[]}:{}), verifyToken:token => ['alice','student'].includes(token) ? token : null, getAccount:async uid => ({ username:uid,role:'user' }),
    canPreview:require('../full-mock/access').createPreviewAccess({all:true}),
    assessment:{ adapters:{ assess:async (q, response, options) => {
      calls.set(q.id, (calls.get(q.id) || 0) + 1);
      if (adapters.SPOKEN.has(q.type) && !options.recording || !adapters.SPOKEN.has(q.type) && !['swt','essay','sst'].includes(q.type)) return native.assess(q, response, options);
      return adapters.result(q, adapters.maxima(q)); // Paid assessments are injected, never called.
    } } } });
  await service.store.initialise();
  app.use(express.static(path.join(root, 'public'), { index:false }));
  app.get('/', (req, res) => res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/portal-workspace.css"><link rel="stylesheet" href="/portal-exam-mode.css"><link rel="stylesheet" href="/full-mock.css"><link rel="stylesheet" href="/mock-report-ui.css"></head><body style="margin:0"><main id="appShell"><section id="fullMockPane" class="pane active"></section></main><script>window.currentUserId="alice";sessionStorage.setItem("pte_session_token","alice");</script><script src="/portal-exam-mode.js"></script><script src="/mock-impact-feedback.js"></script><script src="/mock-report-ui.js"></script><script src="/swt-mock-feedback.js"></script><script src="/full-mock-report.js"></script><script src="/full-mock-client.js"></script><script>'+(listening?'ListeningMock':'FullMock')+'.open();</script></body></html>'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  let browser;
  db.onClose(async () => { await browser?.close(); await service.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive:true, force:true }); });
  browser = await puppeteer.launch({ headless:true, ...(process.env.FULL_MOCK_TEST_CHROME_PATH ? { executablePath:process.env.FULL_MOCK_TEST_CHROME_PATH } : {}),
    args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture=' + microphone] });
  t.diagnostic('Browser: ' + await browser.version() + '; sandbox enabled; synthetic microphone; ' + (mobile ? 'mobile emulation' : 'desktop'));
  const mediaRequests=[];const page = await browser.newPage();page.on('request',request=>{if(request.url().includes('/media/'))mediaRequests.push(request.url());}); await page.setViewport(mobile ? { width:390, height:844, isMobile:true, hasTouch:true, deviceScaleFactor:1 } : { width:1365, height:1000 });
  page.setDefaultTimeout(15000); const unexpectedDialogs = []; let reloading = false;
  page.on('dialog', dialog => {
    if (reloading && dialog.type() === 'beforeunload') return dialog.accept();
    unexpectedDialogs.push(dialog.message()); return dialog.dismiss();
  });
  const errors = [], apiErrors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && /\/api\/(full|listening)-mocks\//.test(response.url())) apiErrors.push(response.status() + ' ' + new URL(response.url()).pathname); });
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('blob:') || request.url().startsWith('data:')) request.continue(); else request.abort(); });
  await page.evaluateOnNewDocument(() => { window.__mockAudio = []; const NativeAudio = window.Audio; window.Audio = class extends NativeAudio { constructor(...args) { super(...args); window.__mockAudio.push(this); } }; window.__cues = 0; const create = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function (...args) { window.__cues++; return create.apply(this, args); }; });
  await page.goto('http://127.0.0.1:' + server.address().port);
  const state = async () => (await service.store.list('alice'))[0];
  return { page, mediaRequests, service, errors, apiErrors, unexpectedDialogs, calls, state, advanceTo:at => { offset += Math.max(0, at - now()); },
    reload:async () => { reloading = true; try { await page.reload(); } finally { reloading = false; } } };
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
for (const [mobile, paper] of [[false,loadPaper()],[true,loadPaper()],[false,loadPaper('full-mock-2')],[true,loadPaper('full-mock-3')],[false,require('../listening-mock/papers').registeredPapers()[0]],[true,require('../listening-mock/papers').registeredPapers()[2]]]) test('Chrome ' + paper.id + ' ' + (mobile ? 'mobile emulation' : 'desktop') + ': native recording, every form, refresh recovery and submitted report', { timeout:240000 }, async t => {
  const listening=paper.module==='listening',count=paper.questions.length;
  const f = await fixture(t, mobile, paper), { page } = f;
  let expectedIndex = 0;
  try {
  await page.waitForSelector('[data-fm="setup"]'); assert(!await page.$eval('.fm-shell',node=>/preview/i.test(node.textContent))); await page.click('[data-fm="setup"][data-paper="' + paper.id + '"]');
  await page.click('[data-fm="sample"]'); await page.waitForSelector('#fm-sample audio');
  await page.click('#fm-sample audio', { offset:{ x:20, y:25 } });
  await page.waitForFunction(() => document.querySelector('#fm-sample audio').currentTime > 0);
  assert(await page.$eval('#fm-begin', node => node.disabled));
  await page.waitForFunction(() => !document.getElementById('fm-heard').disabled);
  await page.click('#fm-heard'); await page.waitForFunction(() => !document.getElementById('fm-begin').disabled); await page.click('#fm-begin');
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await page.waitForSelector('[data-fm="begin-section"]');
  assert.equal((await f.state()).current,null);
  await fs.mkdir(path.join(root,'.cache'),{recursive:true});
  await page.screenshot({path:path.join(root,'.cache','full-mock-flow-' + paper.id + '-' + (mobile?'mobile':'desktop') + '-part1.png')});
  await clickControl(page, '[data-fm="begin-section"]');
  await page.waitForSelector('.fm-exam-meta'); // The section request must finish before checking the next transition.
  if(!listening){await page.waitForSelector('[data-fm="skip"]'); await page.click('[data-fm="skip"]');}
  const expected = new Map(), seen = new Set(); let attemptId, readingDeadline, listeningDeadline;
  for (let i = 0; i < paper.questions.length; i++) {
    const q = paper.questions[i].question;
    expectedIndex = i + 1;
    if (!seen.has(q.type)) t.diagnostic('Entering ' + q.type + ' at question ' + expectedIndex);
    await page.waitForFunction((number,count) => document.querySelector('[data-fm="begin-section"]') || document.querySelector('.fm-exam-meta')?.textContent.includes('Question ' + number + ' of '+count), {}, i + 1,count);
    if (await page.$('[data-fm="begin-section"]')) {
      const waiting = await f.state(); assert.equal(waiting.current, null);
      assert(await page.$eval('.fm-transition', node => node.textContent.includes('Read the instructions')));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await fs.mkdir(path.join(root,'.cache'),{recursive:true});
      await page.screenshot({path:path.join(root,'.cache','full-mock-flow-' + paper.id + '-' + (mobile?'mobile':'desktop') + '-' + waiting.transition.section + '.png')});
      await clickControl(page, '[data-fm="begin-section"]');
    }
    await page.waitForFunction((number,count) => document.querySelector('.fm-exam-meta')?.textContent.includes('Question ' + number + ' of '+count), {}, i + 1,count);
    const saved = await f.state(); attemptId = saved.id; assert.equal(saved.paperId,paper.id); assert.equal(saved.index, i + 1); seen.add(q.type);
    assert(await page.evaluate(() => document.fullscreenElement === document.documentElement && document.getElementById('portal-exam-guard').hidden), 'Fullscreen was lost between questions');
    assert(!await page.$eval('.fm-exam-header', node => /preview/i.test(node.textContent)));
    if (i === 0) await page.$eval('#fm-volume',node=>{node.value='0.35';node.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.$eval('#fm-volume',node=>Number(node.value)),0.35);

    if (!mobile && i === 0) {
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForSelector('#portal-exam-guard:not([hidden])');
      assert(await page.$eval('#fullMockPane',node=>node.inert));
      await clickControl(page,'#portal-exam-guard .portal-button.primary');
      await page.waitForFunction(()=>document.fullscreenElement===document.documentElement&&document.getElementById('portal-exam-guard').hidden);
      assert.equal((await f.state()).current.endsAt,saved.current.endsAt);
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflow at ' + q.type);
    if(q.type==='di'){
      await page.waitForFunction(()=>document.getElementById('fm-image')?.naturalWidth>0);
      if(paper.questions[i].displayImage)assert(f.mediaRequests.some(url=>url.endsWith('/media/'+paper.questions[i].displayImage.sha256)));
      await clickControl(page,'[data-fm="image"]');await page.waitForSelector('#fm-image-dialog[open]');
      assert(await page.$eval('.fm-image-viewport',node=>node.scrollWidth>node.clientWidth));
      await page.$eval('.fm-image-viewport',node=>{node.scrollTop=150;node.scrollLeft=150;});
      assert(await page.$eval('.fm-image-viewport',node=>node.scrollLeft>0));
      await clickControl(page,'[data-fm="close-image"]');assert.equal((await f.state()).current.endsAt,saved.current.endsAt);
      const oldViewport=page.viewport();await page.setViewport({...oldViewport,height:420});
      await page.$eval('#fullMockPane',node=>{node.scrollTop=0;});
      await page.mouse.move(180,240);await page.mouse.wheel({deltaY:900});
      await page.waitForFunction(()=>document.getElementById('fullMockPane').scrollTop>0);
      await page.mouse.wheel({deltaY:-4000});await page.waitForFunction(()=>document.getElementById('fullMockPane').scrollTop===0);
      await page.setViewport(oldViewport);

      assert.equal(await page.$eval('.fm-image-title',node=>node.textContent),q.title);
      assert.equal(await page.$eval('#fm-image',node=>node.alt),q.title);
      assert(await page.evaluate(()=>document.querySelector('.fm-image-title').getBoundingClientRect().bottom<=document.getElementById('fm-image').getBoundingClientRect().top),'Image title is above the image');
    }
    if (q.type === 'dropdown') { readingDeadline ||= saved.current.endsAt; assert.equal(saved.current.endsAt, readingDeadline); }
    if (['lmcma','lfi','hcs','lmcsa','smw','hiw','wfd'].includes(q.type)) { listeningDeadline ||= saved.current.endsAt; assert.equal(saved.current.endsAt, listeningDeadline); }
    if (adapters.SPOKEN.has(q.type)) {
      if (listening || ['ra','rs'].includes(q.type) && paper.questions.find(row => row.question.type === q.type).question.id === q.id) {
        if (q.type === 'rs' && !listening) { f.advanceTo(saved.current.promptAt + 100); await page.waitForFunction(() => /Playing/.test(document.getElementById('fm-audio-status')?.textContent));
          assert.equal(await page.evaluate(()=>window.__mockAudio.at(-1).volume),0.35);
          await page.$eval('#fm-volume',node=>{node.value='0.5';node.dispatchEvent(new Event('input',{bubbles:true}));});
          assert.equal(await page.evaluate(()=>window.__mockAudio.at(-1).volume),0.5);
          await page.$eval('#fm-volume',node=>{node.value='0.35';node.dispatchEvent(new Event('input',{bubbles:true}));}); await page.waitForFunction(() => /Audio completed/.test(document.getElementById('fm-audio-status')?.textContent)); }
        else f.advanceTo(saved.current.responseAt - 2000);
        await page.waitForFunction(() => document.getElementById('fm-record-status')?.textContent === 'Recording');
        await until(async () => (await f.state()).responses[i + 1].segments.some(segment => Object.values(segment.chunks).some(chunk => chunk.stored)), 'Native MediaRecorder did not upload audio.');
        if (q.type === 'rs') assert(await page.evaluate(() => window.__cues > 0), 'Start cue was not produced before the speaking response');
        await clickControl(page, '[data-fm="next"]');
      } else await clickControl(page, '[data-fm="skip"]');
    } else {
      const response = await answer(page, q); expected.set(i + 1, response);
      if ((q.type === 'swt'||listening&&q.type==='sst') && !mobile && ![...expected.keys()].some(index => index !== i + 1 && paper.questions[index - 1].question.type === 'swt')) {
        await page.setOfflineMode(true); await paste(page, '#fm-text', response[0] + ' Saved while offline.'); expected.set(i + 1, [response[0] + ' Saved while offline.']);
        await until(async () => page.evaluate(databaseName => new Promise(resolve => { const open = indexedDB.open(databaseName, 1); open.onsuccess = () => { const db = open.result, read = db.transaction('pending').objectStore('pending').getAll(); read.onsuccess = () => { resolve(read.result.some(row => row.value.kind === 'draft')); db.close(); }; }; }),listening?'ipt-listening-mock-v1':'ipt-full-mock-v1'), 'Offline draft was not saved to IndexedDB.');
        await page.setOfflineMode(false); await f.reload(); await page.waitForSelector('[data-fm="resume"]'); await page.click('[data-fm="resume"]');
        await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
        await page.waitForFunction(value => document.getElementById('fm-text')?.value === value, {}, expected.get(i + 1)[0]);
        assert.equal((await f.state()).current.endsAt, saved.current.endsAt);
      }
      await clickControl(page, '[data-fm="next"]');
    }
  }
  await page.waitForSelector('.fm-report-status'); await page.waitForFunction(() => /^Report ready/.test(document.querySelector('.fm-report-status')?.textContent), { timeout:30000 });
  assert(await page.evaluate(() => !document.fullscreenElement), 'Submitted report did not release fullscreen');
  assert(!await page.$eval('.fm-report-header',node=>/preview/i.test(node.textContent)));
  assert.equal(await page.$('.fm-method,.fm-interpretation'), null);
  assert(await page.$('.ipr-score-report .ipr-logo'), 'Score report is missing the IPT logo');
  if(listening)await page.screenshot({path:path.join(root,'.cache','listening-skill-overview-'+(mobile?'mobile':'desktop')+'.png')});
  await page.click('[data-mock-tab="feedback"]');
  await page.waitForSelector('[data-mock-panel="feedback"]:not([hidden]) .ipr-impact-feedback');
  assert.equal(await page.$$eval('[data-impact-profile]',nodes=>nodes.length),listening?1:5);
  if(listening)assert(await page.$eval('[data-impact-profile="listening"]',node=>node.tagName==='ARTICLE'&&!node.closest('[hidden]')));
  else {await clickControl(page,'[data-impact-profile="writing"] > summary');assert(await page.$eval('[data-impact-profile="writing"]',node=>node.open));}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Feedback overflows viewport');
  await page.click('[data-mock-tab="analysis"]');
  await page.waitForSelector('[data-mock-panel="analysis"]:not([hidden])');
  await f.service.assessor.drain(); const result = await f.service.assessor.results('alice', attemptId), saved = await f.state();
  assert.equal(seen.size, listening?12:22); assert.equal(result.ready, true); assert.equal(result.items.length,count); assert.equal(result.assessedCount,listening?34:35); assert.equal(result.excludedCount,listening?0:30); if(listening)assert.equal(result.profiles.listening.practiceIndex,90);else assert.equal(result.profiles.overall.practiceIndex,null);
  for (const [index, response] of expected) assert.deepEqual(saved.responses[index].answer, response, 'Saved answer for Q' + index);
  assert.deepEqual(f.unexpectedDialogs, []);
  if(listening)assert.equal(saved.responses.slice(1,20).filter(r=>r.segments.some(s=>s.finished&&s.chunkCount>0)).length,19);
  assert.equal(f.calls.size,count); assert([...f.calls.values()].every(count => count === 1)); assert.equal(f.errors.length, 0, f.errors.join('; '));
  for (const type of listening?['rs','rl','asq','sgd']:['ra','rs']) { const index = paper.questions.findIndex(row => row.question.type === type) + 1; assert(saved.responses[index].segments.some(segment => segment.finished && segment.chunkCount > 0)); }
  assert.equal(await page.$$eval('.ipr-overall,.ipr-skill', nodes => nodes.length),listening?2:5); assert.equal(await page.$$eval('#fm-review-select option', nodes => nodes.length),count);
  if(!listening){await page.click('[data-fm="review-type"][data-type="di"]'); await page.click('[data-kind="image"]'); await page.waitForFunction(() => document.querySelector('#fm-review-image img')?.naturalWidth > 0);}
  if(listening)await page.click('[data-mock-tab="answers"]');
  await page.waitForSelector('[data-mock-panel="answers"]:not([hidden])');
  await page.select('#fm-review-select', result.items.find(item => item.type === 'rs').id); await page.click('[data-kind="prompt"]'); await page.waitForSelector('#fm-review-prompt audio');
  await page.select('#fm-review-select', result.items.find(item => item.type === (listening?'rs':'ra')).id); await page.click('[data-kind="recording"]:not([disabled])'); await page.waitForSelector('#fm-review-detail audio');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Report overflows viewport');
  if(listening)await page.screenshot({path:path.join(root,'.cache','listening-skill-report-'+(mobile?'mobile':'desktop')+'.png')});
  await f.reload(); await page.waitForSelector('[data-fm="resume"]'); await page.click('[data-fm="resume"]'); await page.waitForSelector('.fm-report-status');
  assert.equal((await f.service.assessor.results('alice', attemptId)).ready, true); assert([...f.calls.values()].every(count => count === 1));
  } catch (error) {
    const saved = await f.state();
    t.diagnostic('Expected Q' + expectedIndex + '; saved index=' + saved?.index + '; status=' + saved?.status + '; type=' + saved?.responses[saved?.index]?.type);
    t.diagnostic('Guard: '+await page.evaluate(()=>JSON.stringify({body:document.body.innerText.slice(-2200),focus:document.hasFocus(),fullscreenEnabled:document.fullscreenEnabled,guard:document.getElementById('portal-exam-guard')?.outerHTML})));
    await fs.mkdir(path.join(root,'.cache'),{recursive:true});await page.screenshot({path:path.join(root,'.cache','full-mock-error.png')});
    t.diagnostic('Screen: ' + await page.$eval('#fullMockPane', node => node.textContent.slice(-2200)).catch(() => 'unavailable'));
    t.diagnostic('API errors: ' + f.apiErrors.slice(-12).join('; ')); t.diagnostic('Unexpected dialogs: ' + f.unexpectedDialogs.join('; ')); throw error;
  }
});
