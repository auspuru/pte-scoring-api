'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseEnvironment, verifyRelease } = require('../scripts/verify-release');

test('Release checks cannot use production storage, paid providers or mail', () => {
  const source = { PGURL:'private', DATABASE_URL:'private', DATABASE_PUBLIC_URL:'public', ANTHROPIC_API_KEY:'private', OPENAI_API_KEY:'private', AZURE_SPEECH_KEY:'private', AZURE_SPEECH_ENDPOINT:'https://synthetic.cognitiveservices.azure.com', AZURE_SPEECH_RESOURCE:'synthetic', AZURE_SPEECH_REGION:'synthetic', AZURE_SPEECH_LOCALE:'en-US',
    ADMIN_STAFF_USERS:'staff-only', PORTAL_PUBLIC_URL:'https://production.example.test', RAILWAY_PUBLIC_DOMAIN:'production.example.test', GMAIL_USER:'operator', GMAIL_APP_PASSWORD:'private', GMAIL_USER_PASSWORD:'private', RESEND_API_KEY:'private', FULL_MOCK_PREVIEW_USERS:'mahabir1', FULL_MOCK_PREVIEW_ALL:'true', SPEAKING_MOCK_ALERT_TEST:'test-request', RAILWAY_VOLUME_MOUNT_PATH:'/student-data', PATH:'/bin', NODE_ENV:'production' };
  const sanitized = releaseEnvironment(source);
  for (const key of Object.keys(source).filter(k => !['PATH', 'NODE_ENV', 'RAILWAY_VOLUME_MOUNT_PATH'].includes(k))) assert.equal(sanitized[key], '');
  assert.equal(sanitized.RAILWAY_VOLUME_MOUNT_PATH, undefined);
  assert.equal(sanitized.PATH, '/bin');
  assert.equal(releaseEnvironment({MOCK_ALERTS_ENABLED:'true',SPEAKING_MOCK_ALERTS_ENABLED:'true'}).MOCK_ALERTS_ENABLED,'false');
  assert.equal(releaseEnvironment({MOCK_ALERTS_ENABLED:'true',SPEAKING_MOCK_ALERTS_ENABLED:'true'}).SPEAKING_MOCK_ALERTS_ENABLED,'false');
  assert.equal(source.DATABASE_URL, 'private');
  assert.equal(source.PORTAL_PUBLIC_URL, 'https://production.example.test');
  assert.equal(source.RAILWAY_PUBLIC_DOMAIN, 'production.example.test');
});

for (const failedStage of [0, 1, 2]) {
  test(`A failed release stage ${failedStage + 1} blocks promotion and subsequent stages`, () => {
    let calls = 0;
    const code = verifyRelease({ env: {}, run: () => ({ status: calls++ === failedStage ? 1 : 0 }) });
    assert.equal(code, 1);
    assert.equal(calls, failedStage + 1);
  });
}
