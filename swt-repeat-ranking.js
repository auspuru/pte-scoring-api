'use strict';

// Source-reported occurrence numbers are separate from community reports.
// A student can make exactly one report per SWT question. Any question with
// student reports comes before unreported questions; most reports rank first.
const IMPORT_BATCH='nov23-2026-swt';
function verifiedRepeatCount(p) {
  if (!p || p.questionSet!==IMPORT_BATCH) return null;
  if (!Number.isSafeInteger(p.repeatCount) || p.repeatCount<0) return null;
  if (!String(p.repeatEvidence||'').trim()) return null;
  return p.repeatCount;
}
function studentReporterCount(p, counts=new Map()) {
  const value=counts instanceof Map?counts.get(Number(p?.id)):counts?.[p?.id];
  return Number.isSafeInteger(value) && value>0?value:0;
}
function sortSwtPassages(rows,userSwtRank=new Map(),studentReports=new Map()) {
  return [...rows].sort((a,b)=>{
    const aReports=studentReporterCount(a,studentReports);
    const bReports=studentReporterCount(b,studentReports);
    if(aReports!==bReports)return bReports-aReports;

    // Preserve evidence-based source-count order for equal community counts,
    // including unreported questions. Never alter stable passage IDs.
    const ac=verifiedRepeatCount(a),bc=verifiedRepeatCount(b);
    if(ac!==null||bc!==null) {
      if(ac===null)return 1;
      if(bc===null)return -1;
      if(ac!==bc)return bc-ac;
      const ao=Number(a.sourceOrder),bo=Number(b.sourceOrder);
      if(Number.isSafeInteger(ao)&&Number.isSafeInteger(bo)&&ao>0&&bo>0&&ao!==bo)return ao-bo;
      return 0;
    }
    const ar=userSwtRank.get(Number(a.id)),br=userSwtRank.get(Number(b.id));
    if(ar===undefined&&br===undefined)return 0;
    if(ar===undefined)return 1;
    if(br===undefined)return -1;
    return ar-br;
  });
}
module.exports={IMPORT_BATCH,verifiedRepeatCount,studentReporterCount,sortSwtPassages};
