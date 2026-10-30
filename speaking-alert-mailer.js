'use strict';

const { hash } = require('./scoring-jobs');
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
const address = value => /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value);
const failure = (code, httpStatus = 400) => Object.assign(
  Error('Administrator email transport needs attention.'), { code, httpStatus }
);

function createAlertMailer({ env = process.env, nodemailer, fetchImpl = globalThis.fetch } = {}) {
  const selection = (env.MOCK_ALERT_TRANSPORT || env.SPEAKING_MOCK_ALERT_TRANSPORT || 'auto').trim().toLowerCase();
  const useResend = selection === 'resend' || selection === 'auto' && !!(env.RESEND_API_KEY || env.MOCK_ALERT_FROM || env.SPEAKING_MOCK_ALERT_FROM);
  if (!['auto', 'smtp', 'resend'].includes(selection)) {
    return { from: '', mailer: { provider: 'unconfigured', configured: false, configurationError: 'MAIL_TRANSPORT_INVALID' } };
  }
  if (!useResend) {
    const from = (env.GMAIL_USER || '').trim();
    if (!address(from) || !env.GMAIL_APP_PASSWORD) {
      return { from, mailer: { provider: 'smtp', configured: false, configurationError: 'SMTP_NOT_CONFIGURED' } };
    }
    const mailer = nodemailer.createTransport({
      service: 'gmail', auth: { user: from, pass: env.GMAIL_APP_PASSWORD },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
    });
    mailer.provider = 'smtp';
    return { from, mailer };
  }

  const from = (env.MOCK_ALERT_FROM || env.SPEAKING_MOCK_ALERT_FROM || '').trim();
  const configured = !!env.RESEND_API_KEY && address(from);
  const mailer = {
    provider: 'resend', configured, configurationError: configured ? null : 'RESEND_NOT_CONFIGURED',
    replayWindowMs: REPLAY_WINDOW_MS,
    classifyFailure: error => error,
    // Sending-only keys cannot read account settings. Local validation is not
    // represented as a successful live connection or an accepted email.
    async verify() {
      if (!configured) throw failure('RESEND_NOT_CONFIGURED');
      return { configurationOnly: true };
    },
    async sendMail(message) {
      if (!configured) throw failure('RESEND_NOT_CONFIGURED');
      const body = JSON.stringify({
        from: message.from, to: [message.to], reply_to: message.replyTo,
        subject: message.subject, text: message.text,
        headers: { 'Message-ID': message.messageId }
      });
      let response, data;
      try {
        response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error',
          headers: {
            Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json',
            'Idempotency-Key': 'speaking-alert/' + hash(message.messageId)
          },
          body, signal: AbortSignal.timeout(20000)
        });
      } catch {
        // The outbox freezes the body and enforces the provider's replay window.
        // A timeout can therefore retry the same request without a second email.
        throw failure('RESEND_CONNECTION', 503);
      }
      try { data = await response.json(); } catch { data = {}; }
      if (!response.ok) {
        const temporary = response.status >= 500 || [408, 429].includes(response.status) ||
          response.status === 409 && data?.name === 'concurrent_idempotent_requests';
        throw failure('RESEND_HTTP_' + response.status, temporary ? 503 : 400);
      }
      if (typeof data?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(data.id)) {
        throw failure('RESEND_RECEIPT_INVALID', 503);
      }
      return { accepted: [message.to], messageId: data.id };
    }
  };
  return { from, mailer };
}

module.exports = { createAlertMailer, REPLAY_WINDOW_MS };
