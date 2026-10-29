'use strict';

const path = require('node:path');
const { auditInventory } = require('../full-mock/audit');
const { inventory } = require('../full-mock/inventory');
function run(args = process.argv.slice(2)) {
  if (args.some(arg => !['--json', '--strict'].includes(arg))) throw Error('Usage: node scripts/audit-full-mock.js [--json] [--strict]');
  const report = auditInventory({ root: path.resolve(__dirname, '..'), candidates: inventory(),
    reviews: require('../content/full-mock/reviews.json').items, lock: require('../content/full-mock/scoring-lock.json') });
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('Full Mock Phase 1 — candidate audit (no student attempts changed)');
    console.log('Type | Required | Available | Structural checks passed | Reviewed eligible');
    for (const task of report.tasks) console.log([task.type, task.required, task.available, task.structurallyValid, task.reviewedEligible].join(' | '));
    console.log('Scoring source fingerprints: ' + (report.scoringDependenciesPinned ? 'match audit lock' : 'CHANGED: ' + report.scoringDrift.join(', ')));
    console.log('Content ready: ' + report.contentReady + '; full mock released: false.');
    const codes = {};
    for (const candidate of report.candidates) for (const issue of candidate.issues) codes[issue.code] = (codes[issue.code] || 0) + 1;
    console.log('Review/blocker counts: ' + JSON.stringify(codes));
  }
  return !report.scoringDependenciesPinned || args.includes('--strict') && !report.contentReady ? 1 : 0;
}
if (require.main === module) {
  try { process.exitCode = run(); }
  catch (error) { console.error('Full mock audit failed: ' + error.message); process.exitCode = 1; }
}
module.exports = { run };
