'use strict';
const { TASKS } = require('./blueprint');
const { digest, deepFreeze } = require('./paper');
const VERSION = 'full-mock-profiles-2026-10-29.1';
const SOURCE = {
  title: 'PTE Academic — Scoring Information for Teachers and Partners',
  url: 'https://downloads.ctfassets.net/yqwtwibiobs4/UK8K7chHjNJhW9paYHxBd/8e89376c8a2a1d2efee4e3c0ec8200ee/pte-scoring-info-for-partners-report.pdf',
  page: 5, checkedAt: '2026-10-29', sha256: '0863ec05a098f7390a01206750a1220a3c3ecd6344fa211f66220007deda7f6e',
  meaning: 'Published average task-type contributions; not proprietary item weights or a raw-to-GSE conversion.'
};
// Transcribed from Table 1, in blueprint order. Blank cells mean no contribution.
// Preserve the three published inequalities: neither zero nor 0.5 is their value.
const table = [
  ['ra',4,0,0,9,0], ['rs',7,17,0,16,0], ['di',15,0,0,31,0],
  ['rl',6,13,0,13,0], ['asq',2,4,0,0,0], ['sgd',9,20,0,19,0], ['rts',6,0,0,13,0],
  ['swt',7,0,23,0,28], ['essay',7,0,0,0,31],
  ['dropdown',7,0,25,0,0], ['mcma',1,0,5,0,0], ['reorder',3,0,9,0,0],
  ['wordbank',6,0,20,0,0], ['mcsa','<1',0,3,0,0],
  ['sst',4,10,0,0,18], ['lmcma',1,3,0,0,0], ['lfi',3,8,0,0,0],
  ['hcs','<1',2,3,0,0], ['lmcsa','<1',2,0,0,0], ['smw',1,1,0,0,0],
  ['hiw',4,8,13,0,0], ['wfd',5,13,0,0,23]
];
const names = ['overall','listening','reading','speaking','writing'];
const versions = { overall:'full-mock-overall-2026-10-29.1', listening:'full-mock-listening-2026-10-29.1', reading:'full-mock-reading-2026-10-29.1', speaking:'full-mock-speaking-2026-10-29.1', writing:'full-mock-writing-2026-10-29.1' };
const profiles = Object.fromEntries(names.map((name, index) => [name, {
  id: name, version: versions[name],
  weights: Object.fromEntries(table.filter(row => row[index + 1] !== 0).map(row => [row[0], row[index + 1]])),
  policy: 'Sum native earned/possible points within each task type, then apply the published relative task weights. Integrated task points route to every named skill; Overall counts the task once.'
}]));
const PRACTICE_INDEX = {
  version: 'full-mock-practice-index-2026-10-29.1', minimum: 10, maximum: 90,
  policy: '10 + 80 × weighted native-point fraction; an uncalibrated IPT practice index, not Pearson GSE scoring or an exam-score prediction.'
};
function validate(value) {
  if (!value || Object.keys(value).length !== 5 || names.some(name => !value[name]?.version)) throw Error('Five versioned profiles are required.');
  for (const name of names) {
    const expected = TASKS.filter(task => name === 'overall' || task.skills.includes(name)).map(task => task.type).sort();
    if (JSON.stringify(Object.keys(value[name].weights).sort()) !== JSON.stringify(expected)) throw Error('Invalid skill contribution profile: ' + name);
    for (const weight of Object.values(value[name].weights)) if (weight !== '<1' && (!Number.isFinite(weight) || weight <= 0)) throw Error('Invalid contribution weight.');
  }
  return true;
}
validate(profiles);
const SNAPSHOT = deepFreeze({ version: VERSION, source: SOURCE, profiles, practiceIndex: PRACTICE_INDEX });
module.exports = { VERSION, SOURCE: SNAPSHOT.source, PROFILES: SNAPSHOT.profiles, PRACTICE_INDEX: SNAPSHOT.practiceIndex, SNAPSHOT, HASH: digest(SNAPSHOT), validate };
