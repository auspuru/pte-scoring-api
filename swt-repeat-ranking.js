'use strict';

// Exam repetition counts must have independent evidence. Source question
// numbers (#519 etc) are identifiers, not repetition-frequency evidence.
const IMPORT_BATCH = 'nov23-2026-swt';
function verifiedRepeatCount(p) {
  if (!p || p.questionSet !== IMPORT_BATCH) return null;
  if (!Number.isSafeInteger(p.repeatCount) || p.repeatCount < 0) return null;
  if (!String(p.repeatEvidence || '').trim()) return null;
  return p.repeatCount;
}
function sortSwtPassages(rows, userSwtRank = new Map()) {
  return [...rows].sort((a, b) => {
    const ac = verifiedRepeatCount(a), bc = verifiedRepeatCount(b);
    if (ac !== null || bc !== null) {
      if (ac === null) return 1;
      if (bc === null) return -1;
      if (ac !== bc) return bc - ac;
      const ao = Number(a.sourceOrder), bo = Number(b.sourceOrder);
      if (Number.isSafeInteger(ao) && Number.isSafeInteger(bo) && ao > 0 && bo > 0 && ao !== bo) return ao - bo;
      return 0;
    }
    // Preserve legacy prediction-first behavior for unranked passages.
    const ar = userSwtRank.get(Number(a.id)), br = userSwtRank.get(Number(b.id));
    if (ar === undefined && br === undefined) return 0;
    if (ar === undefined) return 1;
    if (br === undefined) return -1;
    return ar - br;
  });
}
module.exports = { IMPORT_BATCH, verifiedRepeatCount, sortSwtPassages };
