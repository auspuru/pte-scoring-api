'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const formPolicy = require('../swt-form-policy');
const writing = require('../writing-lab-scoring');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const start = source.indexOf('function validateForm(');
const end = source.indexOf('\n}', start) + 2;
const legacyForm = vm.runInNewContext(source.slice(start, end) + '\nvalidateForm;', { SwtForm: formPolicy });

const controls = [
  ['five words', 'Trees help cities stay cool.', 1],
  ['75 words', Array(75).fill('tree').join(' ') + '.', 1],
  ['76 words', Array(76).fill('tree').join(' ') + '.', 0],
  ['too short', 'Trees cool cities.', 0],
  ['capitals', 'TREES HELP CITIES STAY COOL.', 0],
  ['mixed case', 'Trees help CITIES stay cool.', 1],
  ['Unicode capitals', 'ÁRBOL ÉCOLE NIÑO ÜBER ÉTÉ.', 0],
  ['no punctuation', 'Trees help cities stay cool', 0],
  ['two sentences', 'Trees help cities stay cool. Planners should maintain them.', 0],
  ['abbreviations and decimals', 'Dr. Lee says U.S. cities need 2.5 times more trees.', 1],
  ['semicolon', 'Trees help cities stay cool; planners should maintain them.', 1],
  ['closing quote', 'Trees help cities stay cool.”', 1],
  ['pasted whitespace', 'Trees\u00a0help\n cities stay cool.', 1],
  ['two paragraphs', 'Trees help cities stay cool.\n\nPlanners should maintain them.', 0]
];

for (const [name, text, expected] of controls) {
  test(`Both SWT entry points use the same form gate: ${name}`, async () => {
    assert.equal(legacyForm(text).score, expected);
    assert.equal(writing.formFor('swt', text).score, expected);
    if (!expected) {
      let calls = 0;
      const result = await writing.grade({ type: 'swt', text: 'Source passage.' }, text, async () => { calls++; });
      assert.equal(calls, 0);
      assert.equal(result.total, 0);
      assert.equal(result.gated, true);
    }
  });
}

test('No supplied key elements can certify full Content without semantic review', () => {
  const functionStart = source.indexOf('function judgeContentLocal(');
  const functionEnd = source.indexOf('\n}', functionStart) + 2;
  const local = vm.runInNewContext(source.slice(functionStart, functionEnd) + '\njudgeContentLocal;', { SWT_CONTENT_MAX: 4 });
  const result = local('Trees help cities stay cool.', 'Trees help cities stay cool.', {}, { score: 2 });
  assert.equal(result.needs_semantic_review, true);
  assert.equal(result.full_content_eligible, false);
});
