'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAlertMailer } = require('../speaking-alert-mailer');
const env = { RESEND_API_KEY: 'test-key', SPEAKING_MOCK_ALERT_FROM: 'alerts@example.test' };
const message = { from: 'IPT <alerts@example.test>', to: 'auspuru@gmail.com', replyTo: 'alerts@example.test', subject: 'Staff attention', text: 'Saved attempt needs checking.', messageId: '<unique-attempt@example.test>' };
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

test('HTTPS uses a fixed trusted endpoint, one recipient, and a stable provider idempotency key', async () => {
  const calls = [];
  const { mailer } = createAlertMailer({ env, fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, { id: 'provider-receipt-1' }); } });
  const receipt = await mailer.sendMail(message);
  await mailer.sendMail(message);
  assert.equal(receipt.messageId, 'provider-receipt-1');
  assert.deepEqual(receipt.accepted, ['auspuru@gmail.com']);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(calls[0].options.body), { from: message.from, to: [message.to], reply_to: message.replyTo, subject: message.subject, text: message.text, headers: { 'Message-ID': message.messageId } });
});

test('configuration verification does not send mail or require a full-access key', async () => {
  const { mailer } = createAlertMailer({ env, fetchImpl: () => { throw Error('must not call provider'); } });
  assert.equal(mailer.configured, true);
  assert.deepEqual(await mailer.verify(), { configurationOnly: true });
});

test('missing HTTPS credentials and invalid sender addresses fail safely without falling back to SMTP', async () => {
  for (const config of [
    { SPEAKING_MOCK_ALERT_TRANSPORT: 'resend' },
    { RESEND_API_KEY: 'test-key' },
    { ...env, SPEAKING_MOCK_ALERT_FROM: 'sender@example.test\r\nBcc: someone@example.test' }
  ]) {
    const { mailer } = createAlertMailer({ env: config, nodemailer: { createTransport() { throw Error('must not use SMTP'); } }, fetchImpl() { throw Error('must not call provider'); } });
    assert.equal(mailer.provider, 'resend');
    assert.equal(mailer.configured, false);
    await assert.rejects(mailer.verify(), { code: 'RESEND_NOT_CONFIGURED' });
    await assert.rejects(mailer.sendMail(message), { code: 'RESEND_NOT_CONFIGURED' });
  }
});

test('HTTPS retries timeouts, temporary provider failures and concurrent requests without leaking response text', async () => {
  for (const fetchImpl of [
    async () => { throw Error('PRIVATE_CREDENTIAL_DETAILS'); },
    async () => response(503, { message: 'PRIVATE_CREDENTIAL_DETAILS' }),
    async () => response(429, { message: 'PRIVATE_CREDENTIAL_DETAILS' }),
    async () => response(409, { name: 'concurrent_idempotent_requests', message: 'PRIVATE_CREDENTIAL_DETAILS' }),
    async () => response(200, {})
  ]) {
    const { mailer } = createAlertMailer({ env, fetchImpl });
    await assert.rejects(mailer.sendMail(message), error => error.httpStatus === 503 && !JSON.stringify(error).includes('PRIVATE_CREDENTIAL_DETAILS'));
  }
});

test('HTTPS holds rejected credentials, invalid sender settings and changed idempotent payloads', async () => {
  for (const status of [400, 401, 403, 409, 422]) {
    const { mailer } = createAlertMailer({ env, fetchImpl: async () => response(status, { name: 'invalid_idempotent_request' }) });
    await assert.rejects(mailer.sendMail(message), { code: 'RESEND_HTTP_' + status, httpStatus: 400 });
  }
});

test('existing SMTP configuration is retained when HTTPS is not configured', () => {
  let options;
  const { from, mailer } = createAlertMailer({ env: { GMAIL_USER: 'portal@example.test', GMAIL_APP_PASSWORD: 'test-password' }, nodemailer: { createTransport(value) { options = value; return {}; } } });
  assert.equal(from, 'portal@example.test');
  assert.equal(mailer.provider, 'smtp');
  assert.equal(options.service, 'gmail');
  assert.equal(options.connectionTimeout, 10000);
});
