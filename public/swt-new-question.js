'use strict';
/* NEW is per student, not a global property of a question. An unfinished
   draft is still NEW; the label disappears when this student has submitted. */
(function (root, factory) {
  const api=factory();
  if (typeof module === 'object' && module.exports) module.exports=api;
  else root.SwtNewQuestion=api;
})(typeof globalThis !== 'undefined'? globalThis : this, function () {
  const IMPORT_BATCH='nov23-2026-swt';
  const novemberBookletNumbers = [
    1, 5, 7, 8, 9, 11, 13, 15, 19, 21, 22, 26, 28, 30, 32, 35,
    36, 37, 41, 45, 46, 47, 49, 50, 51, 56, 64
  ];
  const recentStandaloneIds = new Set([
    '910472', '910504', ...novemberBookletNumbers.map(number => String(951000 + number))
  ]);
  function isNew(p, history, attemptedIds) {
    if (!p || (p.questionSet !== IMPORT_BATCH && !recentStandaloneIds.has(String(p.id)))) return false;
    const ids=[p.id,String(p.id)];
    const attempts=ids.map(id=>history?.[id]).find(rows=>Array.isArray(rows)&&rows.length>0);
    if (attempts) return false;
    if (attemptedIds instanceof Set && ids.some(id=>attemptedIds.has(id))) return false;
    if (Array.isArray(attemptedIds) && ids.some(id=>attemptedIds.includes(id))) return false;
    return true;
  }
  return {IMPORT_BATCH,isNew};
});
