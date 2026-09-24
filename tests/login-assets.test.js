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

test('Release assets are complete and include the full HIW bank', () => {
  const root = path.join(__dirname, '../public');
  assert(validatePublicAssets(root).includes('index.js'));
  const bank = JSON.parse(fs.readFileSync(path.join(root, 'reading-bank.json'), 'utf8'));
  assert.equal(bank.practiceLibraries.find(l => l.id === 'hiw').questions.length, 20);
});


test('Saved-session checks validate the token and successful auth is not mislabeled as a connection failure', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const check = server.slice(server.indexOf("app.get('/api/auth/check/:username'"), server.indexOf('// ═══ ADMIN ROUTES'));
  assert.match(check, /verifySessionToken\(token\)/);
  assert.match(check, /status\(401\)/);
  assert.match(check, /status\(403\)/);

  const client = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
  const login = client.slice(client.indexOf('async function handleLoginSubmit'), client.indexOf('async function handleRegisterSubmit'));
  assert.match(login, /Workspace failed after successful login/);
  assert.match(login, /Signed in successfully, but the workspace could not finish loading/);
  assert.match(client, /bootAuthRevision !== authFlowRevision/);
  assert.match(client, /removeAuthStorageValue\('pte_session_token'\)/);
  assert.match(client, /function removeAuthStorageValue\(key\)/);
});


test('Authentication falls back to session storage when local storage quota is exhausted', () => {
  const client = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
  assert.match(client, /function setAuthStorageValue\(key, value\)/);
  assert.match(client, /sessionStorage\.setItem\(key, value\)/);
  assert.match(client, /sessionStorage wins when localStorage is full/);
  assert.doesNotMatch(client, /localStorage\.setItem\('pte_session_token', d\.token\)/);
  assert.match(client, /getAuthStorageValue\('pte_session_token'\)/);
});


test('Change password uses an authenticated form and a session-derived account', () => {
  const client = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const route = server.slice(server.indexOf("app.post('/api/auth/change-password'"), server.indexOf("app.post('/api/auth/reset-password'"));
  assert.match(page, /id="changePasswordForm"/);
  assert.match(page, /id="changeCurrentPassword"/);
  assert.doesNotMatch(client, /prompt\('Enter your new password/);
  assert.match(client, /JSON\.stringify\(\{ oldPassword: currentPassword, newPassword \}\)/);
  assert.match(route, /verifySessionToken\(token\)/);
  assert.doesNotMatch(route, /const \{ username, oldPassword, newPassword \} = req\.body/);
});


test('Login is handled by a tiny boot client before the main portal bundle', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const boot = fs.readFileSync(path.join(__dirname, '../public/auth-boot.js'), 'utf8');
  assert.match(page, /id="loginSubmitForm"/);
  assert.doesNotMatch(page, /Sign-in has not finished loading/);
  assert(page.indexOf('auth-boot.js') < page.indexOf('index.min.js'));
  assert.match(boot, /\/api\/auth\/login/);
  assert.match(boot, /pte_session_token/);
});

test('Account recovery is email based and passwords require eight characters', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(page, /emailResetRequestForm/);
  assert.doesNotMatch(page, /regSecretQ/);
  assert.match(page, /minlength="8"/);
  assert.match(server, /\/api\/auth\/email-reset\/request/);
  assert.match(server, /\/api\/auth\/email-reset\/complete/);
  assert.match(server, /Password must be at least 8 characters/);
});

test('Shared modal helper provides dialog semantics, Escape and focus trapping', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/portal-accessibility.js'), 'utf8');
  assert.match(source, /aria-modal/);
  assert.match(source, /ev\.key==='Escape'/);
  assert.match(source, /ev\.key!=='Tab'/);
  assert.match(source, /portalUndoToast/);
});
