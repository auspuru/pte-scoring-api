'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareCatalogue, validateStagedPassages } = require('../scripts/validate-swt-nov23-staging');
const [example] = require('../content/swt-nov23-practice.staged.json');

test('November SWT staging validates all screenshots, dispositions, ready passages and references', () => {
  const review = validateStagedPassages();
  assert.equal(review.screenshots, 43);
  assert.equal(review.ready + review.withheld, review.screenshots);
  assert(review.ready > 0 && review.withheld > 0);
});

test('November SWT preflight distinguishes retries, existing passage IDs, and occupied IDs', () => {
  const match = { id: 123, title: 'Renamed source', text: example.text.replace(/\s+/g, ' ').toUpperCase() };
  assert.deepEqual(compareCatalogue([example], [match]), [{
    proposedId: example.id, status: 'duplicate-passage', existingId: match.id, existingTitle: match.title
  }]);
  for (const [text, status] of [[match.text, 'already-present'], ['A different source.', 'id-collision']]) {
    assert.equal(compareCatalogue([example], [{ ...match, id: example.id, text }])[0].status, status);
  }
});
