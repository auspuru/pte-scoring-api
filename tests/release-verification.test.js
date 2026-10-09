'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseEnvironment, verifyRelease } = require('../scripts/verify-release');

test('Release checks cannot use production storage, paid providers or mail', () => {
  const source = { PGURL:'private', DATABASE_URL:'private', DATABASE_PUBLIC_URL:'public', ANTHROPIC_API_KEY:'private', OPENAI_API_KEY:'private', AZURE_SPEECH_KEY:'private',
    GMAIL_USER:'operator', GMAIL_APP_PASSWORD:'private', GMAIL_USER_PASSWORD:'private', RAILWAY_VOLUME_MOUNT_PATH:'/student-data', PATH:'/bin', NODE_ENV:'production' };
  const sanitized = releaseEnvironment(source);
  for (const key of Object.keys(source).filter(k => !['PATH', 'NODE_ENV', 'RAILWAY_VOLUME_MOUNT_PATH'].includes(k))) assert.equal(sanitized[key], '');
  assert.equal(sanitized.RAILWAY_VOLUME_MOUNT_PATH, undefined);
  assert.equal(sanitized.PATH, '/bin');
  assert.equal(source.DATABASE_URL, 'private');
});

for (const failedStage of [0, 1, 2]) {
  test(`A failed release stage ${failedStage + 1} blocks promotion and subsequent stages`, () => {
    let calls = 0;
    const code = verifyRelease({ env: {}, run: () => ({ status: calls++ === failedStage ? 1 : 0 }) });
    assert.equal(code, 1);
    assert.equal(calls, failedStage + 1);
  });
}
