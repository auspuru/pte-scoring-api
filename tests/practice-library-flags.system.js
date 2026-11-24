'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const puppeteer = require('puppeteer');
const { testDatabaseUrl, until } = require('./helpers/full-mock-systems');
const { fixture } = require('./helpers/auth-server');

test('Practice flags share only report totals and preserve SWT numbering across accounts', { timeout: 120000 }, async t => {
  const base = testDatabaseUrl(process.env.FULL_MOCK_TEST_DATABASE_URL);
  const schema = 'practice_flags_' + randomUUID().replaceAll('-', '');
  const pool = new Pool({ connectionString: base });
  await pool.query('CREATE SCHEMA ' + schema);
  const connection = new URL(base);
  connection.searchParams.set('options', '-c search_path=' + schema);
  const f = await fixture(t, {
    databaseUrl: connection.toString(),
    afterStop: async () => {
      await pool.query('DROP SCHEMA ' + schema + ' CASCADE');
      await pool.end();
    }
  });
  const password = 'Synthetic-pass-123';
  async function account(username) {
    const registration = await f.request('/api/auth/register', { username, password, email: username + '@example.test' });
    assert.equal(registration.body.success, true);
    return registration.body.token;
  }
  const first = await account('report-first');
  const second = await account('report-second');
  let passages;
  await until(async () => {
    passages = (await f.request('/api/passages')).body.passages;
    return passages?.some(p => p.questionSet === 'nov23-2026-swt');
  }, 'SWT prediction import completes in the isolated database');
  const newPosition = passages.findIndex(p => p.questionSet === 'nov23-2026-swt');
  assert.ok(newPosition > 0);
  const questionId = String(passages[newPosition].id);
  const swtRoute = '/api/practice-library/swt/flags';
  async function put(task, questionId, kind, enabled, token) {
    const response = await fetch(f.base + '/api/practice-library/' + task + '/flags', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-token': token },
      body: JSON.stringify({ questionId, kind, enabled })
    });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await f.request(swtRoute)).status, 401);
  const legacy = await f.request('/api/swt/exam-reports/' + questionId, {}, first);
  assert.equal(legacy.status, 200);
  assert.equal((await f.request(swtRoute, undefined, second)).body.questions[questionId].count, 1);
  const saves = await Promise.all([
    put('swt', questionId, 'report', true, second),
    put('swt', questionId, 'report', true, second)
  ]);
  assert.deepEqual(saves.map(result => result.status), [200, 200]);
  const mine = (await f.request(swtRoute, undefined, first)).body.questions[questionId];
  assert.equal(mine.count, 2);
  assert.equal(mine.reported, true);
  assert.equal((await put('swt', questionId, 'bookmark', true, first)).body.bookmarked, true);
  assert.notEqual((await f.request(swtRoute, undefined, second)).body.questions[questionId].bookmarked, true);
  assert.equal((await put('swt', questionId, 'report', false, second)).body.count, 1);
  assert.deepEqual((await f.request('/api/passages')).body.passages.map(p => p.id), passages.map(p => p.id));

  const dictation = (await f.request('/api/writing-lab/catalog', undefined, first)).body.dictation[0].id;
  assert.equal((await put('dictation', dictation, 'report', true, first)).body.count, 1);
  const otherReport = (await f.request('/api/practice-library/dictation/flags', undefined, second)).body.questions[dictation];
  assert.deepEqual(otherReport, { count: 1, reported: false, bookmarked: false });
  assert.equal((await put('dictation', 'unrecognised-question', 'report', true, first)).status, 404);
  assert.equal((await put('practice', 'personal-essay', 'report', true, first)).status, 404);
  for (const id of ['seed_35', 'seed_36']) {
    assert.equal((await put('practice', id, 'report', true, first)).body.count, 1);
  }
  assert.equal((await put('practice', 'seed_37', 'report', true, first)).status, 404);

  const browser = await puppeteer.launch({ headless: true, executablePath: process.env.FULL_MOCK_TEST_CHROME_PATH || undefined });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/api/practice-library/') && !response.ok()) errors.push('Flag request HTTP ' + response.status());
  });
  await page.setViewport({ width: 390, height: 850 });
  await page.goto(f.base, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.type('#loginUsername', 'report-first');
  await page.type('#loginPassword', password);
  await page.locator('#loginSubmitBtn').click();
  await page.waitForFunction(() => document.getElementById('appShell')?.style.display === 'grid' && document.getElementById('loadingVeil')?.classList.contains('hidden'));
  await page.evaluate(() => switchSection('swt'));
  const row = '#swtQuestionRows [data-question-key="' + questionId + '"]';
  try {
    await page.waitForSelector(row + ' [data-library-flag="report"]:not([disabled])', { visible: true, timeout: 12000 });
  } catch (error) {
    const details = await page.evaluate(() => ({
      script: Boolean(window.PracticeLibraryActions),
      library: document.querySelector('[data-practice-library-task="swt"]')?.dataset.practiceLibraryTask,
      firstKeys: [...document.querySelectorAll('#swtQuestionRows > article')].slice(0, 4).map(node => node.dataset.questionKey),
      feedback: document.querySelector('[data-library-feedback]')?.textContent
    }));
    assert.fail(JSON.stringify({ errors, details, failure: error.message }));
  }
  assert.match(await page.$eval(row + ' [data-library-report-count]', el => el.textContent), /^1 report$/);
  assert.equal(await page.$eval(row + ' .practice-library-number', el => el.textContent), '#' + (newPosition + 1));
  const newSwitch='#swtQuestionLibrary [data-library-new-only]';
  await page.focus(newSwitch);
  await page.keyboard.press('Space');
  assert.equal(await page.$eval(newSwitch, el => el.getAttribute('aria-checked')), 'true');
  const visible='#swtQuestionRows > article:not([hidden])';
  assert.equal(await page.$$eval(visible, rows => rows.every(el => el.dataset.questionNew === 'true')), true);
  assert.ok(await page.$(visible+'[data-question-key="'+questionId+'"]'));
  assert.ok(await page.$('#swtQuestionRows > article[data-question-new="false"][hidden]'));
  await page.locator('#swtQuestionSearch').fill('#1');
  await page.waitForFunction(() => document.querySelector('#swtQuestionLibrary [data-library-feedback]')?.textContent === 'No new questions match these filters.');
  await page.$eval('#swtQuestionSearch', node => node.select());
  await page.keyboard.press('Backspace');
  await page.waitForSelector(visible+'[data-question-key="'+questionId+'"]', { visible: true });
  await page.select('[data-practice-library-task="swt"] [data-library-sort]', 'reported');
  assert.equal(await page.$eval('#swtQuestionRows > article', el => el.dataset.questionKey), questionId);
  await page.locator('[data-practice-library-task="swt"] [data-library-view="revision"]').click();
  assert.equal(await page.$$eval('#swtQuestionRows > article:not([hidden])', rows => rows.length), 1);
  await page.locator(row + ' [data-library-flag="bookmark"]').click();
  await page.waitForSelector(row + '[hidden]');
  assert.equal(await page.$$eval('#swtQuestionRows > article:not([hidden])', rows => rows.length), 0);
  await page.locator('[data-practice-library-task="swt"] [data-library-view="all"]').click();
  await page.locator(row + ' [data-library-flag="report"]').click();
  await page.waitForFunction(sel => document.querySelector(sel + ' [data-library-report-count]')?.textContent === '0 reports', {}, row);
  await page.locator(newSwitch).click();
  assert.equal(await page.$eval(newSwitch, el => el.getAttribute('aria-checked')), 'false');
  assert.ok(await page.$(visible+'[data-question-new="false"]'));
  await page.select('[data-practice-library-task="swt"] [data-library-sort]', 'default');
  assert.equal(await page.$eval('#swtQuestionRows > article', el => el.dataset.questionKey), String(passages[0].id));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});
