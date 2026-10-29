'use strict';
const fs = require('node:fs');
const { readiness, runtimeContext, MANUAL } = require('../full-mock/validation');
function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--template') return { code:0, report:{ schemaVersion:1, context:runtimeContext(), checks:MANUAL.map(id => ({ id, status:'pending', checkedAt:null, evidenceRef:null, reviewedBy:null })) } };
  let automated = null, manual = null, release = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--release') release = true;
    else if (['--automated','--manual'].includes(args[i]) && args[i + 1]) {
      const flag = args[i++]; let evidence; try { evidence = JSON.parse(fs.readFileSync(args[i], 'utf8')); } catch { throw Error('Release evidence could not be read.'); }
      if (flag === '--automated') automated = evidence; else manual = evidence;
    } else throw Error('Usage: check-full-mock-release.js [--automated file] [--manual file] [--release]');
  }
  const report = readiness({ automated, manual }); return { report, code:release && !report.studentReleaseEnabled ? 1 : 0 };
}
if (require.main === module) { try { const { report, code } = main(); console.log(JSON.stringify(report, null, 2)); process.exitCode = code; } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { main };
