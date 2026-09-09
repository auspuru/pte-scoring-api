'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/swt-ui.css'), 'utf8');
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function functionSource(name, async = false) {
  const start = source.indexOf((async ? 'async ' : '') + 'function ' + name + '(');
  assert(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('The headline shows an estimate; raw traits live in a collapsed breakdown', () => {
  const hero = html.slice(html.indexOf('id="heroScore"'), html.indexOf('id="swtGuidanceBody"'));
  assert.match(hero, /PTE estimate/);
  assert(!hero.includes('Content score'));
  assert(!hero.includes('Trait total'));
  assert.match(html, /<details[^>]*aria-labelledby="swtTraitsHeading"/);
  assert(!html.includes('Highlights are a reading aid'));
  assert(!html.includes('id="coverageTable"'));
  assert(!source.includes('Band-9 sample loaded'));
  assert.match(html, /id="sampleAnswerNotes" role="status" aria-live="polite"/);
});

test('Passage and response rendering preserves plain text without line highlights or HTML injection', () => {
  const target = { textContent: '', innerHTML: '' };
  const context = { document: { getElementById: id => id === 'annotatedFeedback' ? null : target }, escapeHtml };
  vm.createContext(context);
  vm.runInContext(functionSource('renderAnnotatedPassage') + '\n' + functionSource('renderAnnotatedSubmission'), context);
  const text = 'Important phrase <img onerror="bad()">\nSecond paragraph.';
  context.renderAnnotatedPassage({ text });
  assert.equal(target.textContent, text);
  assert.equal(target.innerHTML, '');
  context.renderAnnotatedSubmission({}, {}, {}, text);
  assert.equal(target.textContent, text);
  assert.equal(target.innerHTML, '');
});

test('Key idea cards separate quoted phrases from their explanation and escape all content', () => {
  const target = { innerHTML: '' };
  const context = { document: { getElementById: () => target }, escapeHtml };
  vm.createContext(context);
  vm.runInContext(functionSource('renderSwtKeyPhrases'), context);
  context.renderSwtKeyPhrases({ studyGuide: { overview: '<script>bad</script>',
    items: [{ label: 'Main idea', phrases: ['a large percentage of GDP'], idea: '<img src=x onerror=bad()>' }],
    connection: 'Benefits are related, not all causal.' } });
  assert.match(target.innerHTML, /<q>a large percentage of GDP<\/q>/);
  assert.match(target.innerHTML, /How the ideas connect:/);
  assert(!target.innerHTML.includes('<script>'));
  assert(!target.innerHTML.includes('<img'));
  assert(!target.innerHTML.includes('Not selected'));
});

test('Async sample checks cannot replace the next passage’s sample after navigation', async () => {
  const old = { id: 8 }, current = { id: 9 };
  const note = { textContent: '', dataset: {}, setAttribute() {} };
  const sample = { textContent: 'Current passage sample' };
  let finish;
  const context = { swtResultPassage: old,
    document: { getElementById: id => id === 'sampleAnswerNotes' ? note : sample },
    checkSwtSample: () => new Promise(resolve => { finish = resolve; }) };
  vm.createContext(context);
  vm.runInContext(functionSource('refreshSwtSample', true), context);
  const pending = context.refreshSwtSample(old);
  context.swtResultPassage = current;
  note.textContent = 'Current passage note';
  finish({ status: 'verified', sample: 'Old sample', note: 'Old note' });
  await pending;
  assert.equal(sample.textContent, 'Current passage sample');
  assert.equal(note.textContent, 'Current passage note');
});

test('Score cards size independently and phrase cards stack on narrow screens', () => {
  assert.match(css, /\.trait-breakdown[^}]*align-items: start/);
  assert.match(css, /\.trait-note[^}]*font-style: normal/);
  const mobile = css.slice(css.indexOf('@media (max-width: 560px)'));
  assert.match(mobile, /\.swt-key-grid[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /focus-visible[^}]*outline:/);
});
