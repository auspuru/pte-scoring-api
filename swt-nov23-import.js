'use strict';

const { createHash } = require('node:crypto');

function normalizedPassageHash(text) {
  const words = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return createHash('sha256').update(words.join(' ')).digest('hex');
}

function compareCatalogue(passages, existing) {
  const indexById = new Map(existing.filter(row => row.id != null).map(row => [String(row.id), row]));
  const indexByText = new Map(existing.map(row => [normalizedPassageHash(row.text), row]));
  return passages.flatMap(passage => {
    const hash = normalizedPassageHash(passage.text);
    const idMatch = indexById.get(String(passage.id));
    const exactMatch = indexByText.get(hash);
    if (!idMatch && !exactMatch) return [];

    const match = idMatch || exactMatch;
    let status = 'duplicate-passage';
    if (idMatch) {
      // A matching import receipt also identifies passages edited by teachers.
      const sameSource = idMatch.questionSet === passage.questionSet && passage.questionSet
        && idMatch.sourceScreenshot === passage.sourceScreenshot && passage.sourceScreenshot
        && idMatch.sourceQuestionNumber === passage.sourceQuestionNumber;
      status = sameSource || normalizedPassageHash(idMatch.text) === hash ? 'already-present' : 'id-collision';
    }
    return [{ proposedId: passage.id, status, existingId: match.id ?? null, existingTitle: match.title }];
  });
}

async function importPassages(pool, passages) {
  // Check authoritative rows and insert in the same transaction. The table lock
  // serializes writers while still allowing students to read the catalogue.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query('LOCK TABLE passages IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query('SELECT id, payload FROM passages');
    const existing = rows.map(({ id, payload }) => ({ ...payload, id }));
    const matches = compareCatalogue(passages, existing);
    const conflicts = matches.filter(match => match.status !== 'already-present');
    if (conflicts.length) {
      throw Error('SWT import conflicts: ' + conflicts.map(({ proposedId, existingId, status }) =>
        proposedId + '/' + existingId + ' ' + status).join(', '));
    }
    const present = new Set(matches.map(match => match.proposedId));
    const additions = passages.filter(passage => !present.has(passage.id));
    for (const passage of additions) {
      await client.query('INSERT INTO passages (id, payload) VALUES ($1, $2::jsonb)', [passage.id, passage]);
    }
    await client.query('COMMIT');
    return { checked: existing.length, added: additions.length, alreadyPresent: present.size };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { compareCatalogue, importPassages, normalizedPassageHash };
