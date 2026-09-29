'use strict';

const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const referenceKey = passage => normalize(passage?.title).toLowerCase() + '\u0000' + normalize(passage?.text);

function repairMissingSwtSamples(passages, references) {
  const byContent = new Map();
  for (const reference of references || []) {
    const sampleResponse = normalize(reference?.sampleResponse);
    if (!sampleResponse || !normalize(reference?.title) || !normalize(reference?.text)) continue;
    byContent.set(referenceKey(reference), reference);
  }

  const updates = [];
  const repaired = (passages || []).map(passage => {
    if (normalize(passage?.sampleResponse)) return passage;
    const reference = byContent.get(referenceKey(passage));
    if (!reference) return passage;

    const next = {
      ...passage,
      sampleResponse: normalize(reference.sampleResponse),
      sampleNotes: normalize(passage.sampleNotes) || normalize(reference.sampleNotes)
    };
    updates.push({
      id: Number(passage.id) || 0,
      title: String(passage.title || ''),
      text: String(passage.text || ''),
      sampleResponse: next.sampleResponse,
      sampleNotes: next.sampleNotes
    });
    return next;
  });

  return { passages: repaired, updates };
}

module.exports = { repairMissingSwtSamples };
