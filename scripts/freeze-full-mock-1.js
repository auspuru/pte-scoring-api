'use strict';
const { freezePaper } = require('../full-mock/paper');
const { candidates } = require('../full-mock/authoring');
if (require.main === module) {
  try { console.log(freezePaper({ candidates: candidates(), lock: require('../content/full-mock/scoring-lock.json'), sourceCommit: '1d6bc40cb07a54ce3058528c09118736b34eee6a' })); }
  catch (error) { console.error('Full Mock 1 freeze failed: ' + error.message); process.exitCode = 1; }
}
