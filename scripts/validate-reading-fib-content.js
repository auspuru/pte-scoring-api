'use strict';
const bank = require('../public/reading-bank.json');
const quality = require('../public/reading-fib-quality');
const catalogue = require('../public/practice-catalogue');
const tools = require('../public/reading-mock-tools');

const FIB = new Set(['dropdown','wordbank']);

function validateQuestion(raw, label) {
  if (!raw || !FIB.has(raw.type)) return null;
  const q = quality.strengthen(raw, 'publication:' + (raw.uid || raw.id || label));
  if (!Array.isArray(q.answers) || !q.answers.length) throw Error(label + ': missing answers.');
  if (!quality.audit(q)) throw Error(label + ': failed shared FIB quality audit.');
  if (!q.fibQuality || q.fibQuality.focus !== 'grammar-vocabulary') throw Error(label + ': missing FIB quality metadata.');
  if (!q.reasoning || !Array.isArray(q.reasoning.blanks) || q.reasoning.blanks.length !== q.answers.length) {
    throw Error(label + ': every blank needs sentence-specific reasoning.');
  }
  q.reasoning.blanks.forEach((blank, i) => {
    if (blank.answer !== q.answers[i]) throw Error(label + ': reasoning answer mismatch at blank ' + (i + 1) + '.');
    const explanation = String(blank.explanation || '');
    if (explanation.length < 80 || !/grammar/i.test(explanation) || !/(vocabulary|collocation)/i.test(explanation)) {
      throw Error(label + ': blank ' + (i + 1) + ' lacks a usable grammar + vocabulary/collocation explanation.');
    }
  });
  if (!/No specialist subject knowledge is required/i.test(String(q.reasoning.correct || ''))) {
    throw Error(label + ': missing language-first guidance.');
  }
  if (q.type === 'dropdown') {
    q.options.forEach((row, i) => {
      if (row.length !== 4 || new Set(row).size !== 4 || !row.includes(q.answers[i])) {
        throw Error(label + ': invalid option set at blank ' + (i + 1) + '.');
      }
    });
  } else {
    if (q.bank.length !== q.answers.length + 3 || new Set(q.bank).size !== q.bank.length) {
      throw Error(label + ': invalid drag-and-drop word bank.');
    }
  }
  return q;
}

function activeFibQuestions() {
  const rows = [];
  for (const library of catalogue.readingLibraries(bank).filter(l => FIB.has(l.id))) {
    for (const q of library.questions) rows.push({ surface:'practice', q, label:'Practice ' + library.id + ' ' + (q.uid || q.id) });
  }
  for (const set of bank.sets || []) {
    for (const q of tools.compose(bank, 'mock', set.id).questions.filter(q => FIB.has(q.type))) {
      rows.push({ surface:'reading-set', q, label:'Reading set ' + set.id + ' ' + (q.uid || q.id) });
    }
  }
  for (const preset of (bank.mockCatalogue || []).filter(m => m.kind === 'reading-blanks')) {
    for (const q of tools.compose(bank, preset.id, preset.setId).questions.filter(q => FIB.has(q.type))) {
      rows.push({ surface:'focused-mock', q, label:'Focused mock ' + preset.id + ' ' + (q.uid || q.id) });
    }
  }
  return rows;
}

function validateReadingFibContent() {
  const rows = activeFibQuestions();
  const unique = new Map();
  for (const row of rows) {
    const q = validateQuestion(row.q, row.label);
    const key = q.uid || row.surface + ':' + q.id;
    if (!unique.has(key)) unique.set(key, { ...row, q });
  }
  const questions = [...unique.values()];
  const counts = Object.fromEntries([...FIB].map(type => [type, questions.filter(x => x.q.type === type).length]));
  return {
    surfaces: rows.length,
    unique: questions.length,
    dropdown: counts.dropdown || 0,
    wordbank: counts.wordbank || 0,
    patternDerived: questions.filter(x => x.q.patternBased).length,
    qualityVersion: quality.VERSION
  };
}

if (require.main === module) {
  const r = validateReadingFibContent();
  console.log('Validated ' + r.unique + ' unique active Reading FIB questions across ' + r.surfaces + ' published surfaces (' +
    r.dropdown + ' dropdown, ' + r.wordbank + ' drag-and-drop; quality ' + r.qualityVersion + ').');
}

module.exports = { validateQuestion, activeFibQuestions, validateReadingFibContent };
