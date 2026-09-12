'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { validatePublicAssets } = require('../scripts/validate-public-assets');

test('Deployment validation rejects the truncation that disabled sign-in', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipt-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'reading-bank.json'), '{}');
  fs.writeFileSync(path.join(root, 'index.js'), 'Warning: truncated output\nfunction handleLoginSubmit() {}');
  assert.throws(() => validatePublicAssets(root), /Invalid public asset index.js/);
  fs.writeFileSync(path.join(root, 'index.js'), 'function handleLoginSubmit() {}');
  fs.writeFileSync(path.join(root, 'reading-bank.json'), '{"questions": [');
  assert.throws(() => validatePublicAssets(root), /Invalid public asset reading-bank.json/);
});

test('Login keeps the form in place and shows an error when the application cannot load', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const handler = html.slice(html.indexOf('id="loginForm"')).match(/<form onsubmit="([^"]+)"/)[1];
  const fields = { loginUsername: { value: 'student' }, loginPassword: { value: 'test-password' }, loginError: { style: {}, textContent: '' } };
  let cancelled = false;
  const context = { event: { preventDefault() { cancelled = true; } }, document: { getElementById: id => fields[id] } };
  vm.runInNewContext(handler, context);
  assert(cancelled);
  assert.equal(fields.loginUsername.value, 'student');
  assert.equal(fields.loginPassword.value, 'test-password');
  assert.equal(fields.loginError.style.display, 'block');
  assert.match(fields.loginError.textContent, /refresh this page/);
  let calls = 0;
  context.handleLoginSubmit = event => { assert.equal(event, context.event); calls++; };
  vm.runInNewContext(handler, context);
  assert.equal(calls, 1);
});

test('Release assets are complete and include the full HIW bank', () => {
  const root = path.join(__dirname, '../public');
  assert(validatePublicAssets(root).includes('index.js'));
  const bank = JSON.parse(fs.readFileSync(path.join(root, 'reading-bank.json'), 'utf8'));
  assert.equal(bank.practiceLibraries.find(l => l.id === 'hiw').questions.length, 20);
});
