(function(root){
  'use strict';
  function circle(label,value){
    const valid=Number.isFinite(value)&&value>=0&&value<=90;
    const score=valid?Math.round(value):null, offset=314.16*(1-(score||0)/90);
    return '<div style="display:grid;justify-items:center;gap:8px;flex:0 1 160px"><div style="position:relative;width:112px;height:112px" role="img" aria-label="'+label+': '+(score===null?'pending':score+' out of 90')+'"><svg viewBox="0 0 120 120" width="112" height="112" aria-hidden="true" style="transform:rotate(-90deg)"><circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" opacity=".12" stroke-width="7"/><circle cx="60" cy="60" r="50" fill="none" stroke="var(--accent,#287e8a)" stroke-width="7" stroke-linecap="round" stroke-dasharray="314.16" stroke-dashoffset="'+offset+'"/></svg><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><strong style="font-size:28px;line-height:1.15">'+(score===null?'—':score)+'</strong><span style="font-size:12px">/90</span></div></div><span style="font-size:13px;font-weight:600;text-align:center">'+label+'</span></div>';
  }
  function render(reading,writing){
    return '<div style="display:flex;flex-wrap:wrap;gap:24px;margin:20px 0" aria-label="PTE score estimates">'+circle('PTE reading estimate',reading)+circle('PTE writing estimate',writing)+'</div><p style="font-size:12px;line-height:1.5;opacity:.8">Practice estimates for this response, not official Pearson scores or overall skill predictions.</p>';
  }
  root.PteEstimateDisplay={render};
})(typeof window!=='undefined'?window:globalThis);
