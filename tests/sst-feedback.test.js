'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { render } = require('../public/sst-feedback');

test('SST feedback distinguishes main ideas from supporting details and escapes response evidence', () => {
  const html = render({
    response:'<script>answer</script>',
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
  assert.match(html, /the bold idea in your own words/);
  assert.doesNotMatch(html, /sst-idea-status|Next step/);
});
