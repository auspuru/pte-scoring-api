'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { render } = require('../public/sst-feedback');

test('SST feedback distinguishes main ideas from supporting details and escapes response evidence', () => {
  const html = render({
    response:'<script>answer</script> <marked>',
    nextStep:'Explain the limitation.',
    ideas:[
      { main:'Research is faster.', supporting:['More sources are accessible.'], status:'covered', evidence:'<marked>' },
      { main:'Sources can be unreliable.', supporting:[], status:'missed' }
    ]
  });
  assert.match(html, /<strong>Research is faster\.<\/strong><span[^>]+>Covered<\/span>/);
  assert.match(html, /<li>More sources are accessible\.<\/li>/);
  assert.match(html, /<strong>Sources can be unreliable\.<\/strong><span[^>]+>Missed<\/span>/);
  assert.match(html, /&lt;script&gt;answer&lt;\/script&gt;/);
  assert.match(html, /&lt;marked&gt;/);
  assert.match(html, /Explain the limitation\./);
});

test('Unreviewed SST ideas display without inventing coverage', () => {
  const html = render({ ideas:[{main:'Urban trees cool cities.', supporting:[]}] });
  assert.match(html, /Urban trees cool cities/);
  assert.doesNotMatch(html, /sst-idea-status|Next step/);
});

test('SST review places confirmed scores before the full transcript and links exact covered source spans', () => {
  const html = render({
    transcript:'Research is faster <online>. Results can be unreliable.',
    response:'Researchers get information quickly.',
    ideas:[{main:'Research is faster.',status:'covered'}, {main:'Reliability is a concern.',status:'missed'}],
    highlights:[['Research is faster <online>'], ['absent quotation']],
    total:10, maximum:12, scores:{content:2,form:2}, maxima:{content:4,form:2},
    criterionFeedback:{form:'Within the limit.'}
  });
  assert.ok(html.indexOf('Total score') < html.indexOf('Recording transcript'));
  assert.match(html, /<dt>Total score<\/dt><dd>10 \/ 12/);
  assert.match(html, /<mark[^>]+>Research is faster &lt;online&gt;<\/mark>\. Results can be unreliable\./);
  assert.equal((html.match(/data-sst-passage=/g)||[]).length,1);
  assert.match(html, /<summary>Marking details<\/summary>/);
  assert.match(html, /Within the limit/);
});

test('SST review keeps an unmatched transcript and pending results visible without assigning marks', () => {
  const html = render({transcript:'The saved source.',response:'Saved answer.',status:'Assessment pending.'});
  assert.match(html, /<dt>Total score<\/dt><dd>—/);
  assert.match(html, /Assessment pending/);
  assert.match(html, /The saved source/);
  assert.match(html, /Saved answer/);
  assert.doesNotMatch(html, /sst-idea-status|data-sst-passage/);
});
