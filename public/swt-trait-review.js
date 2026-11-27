/* Read-only display of saved SWT marks. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SwtTraitReview=api;
})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const traits = [
    ['content','Content','Include the key ideas and show how they connect. Leaving out a minor example can still earn full marks. Missing a key idea can lower your score. If a missing cause, contrast or condition changes the main claim, Content can drop to 2/4 or lower.'],
    ['form','Form','Write one complete sentence of 5–75 words.'],
    ['grammar','Grammar','Use correct sentence structure and make each verb agree with its subject.'],
    ['vocabulary','Vocabulary','Choose words that fit the meaning. Simple words and accurate terms from the passage are fine.']
  ];
  const escape = value => String(value??'').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const number = value => Number(value.toFixed(2));

  function render({scores={},maxima={},details={},pending=false,gated=false,total:awardedTotal}={}){
    const valid = (key) => Number.isFinite(scores[key]) && Number.isFinite(maxima[key])
      && maxima[key]>0 && scores[key]>=0 && scores[key]<=maxima[key];
    const status = (score,max) => {
      const difference=number(max-score);
      return difference===0 ? 'Full marks' : difference+' '+(difference===1?'point':'points')+' to gain';
    };
    const entries = traits.map(([key,label,guide])=>{
      const known=!pending&&valid(key);
      const full=known&&scores[key]===maxima[key];
      const score=known?number(scores[key])+' / '+number(maxima[key]):'—';
      const explanation=pending?'The assessment is still being prepared.':gated?'The scoring rule for this response applies to the whole item.':
        details[key] || (full?'You earned full marks for this trait.':known?'This saved result has no separate explanation for this trait.':'A confirmed mark is unavailable.');
      return '<details class="swt-trait-tile '+(gated||!known?'neutral':full?'earned':'progress')+'"><summary><strong>'+label+
        '</strong><span class="swt-trait-value">'+score+'</span><span>'+escape(known?(gated?'Item rule applied':status(scores[key],maxima[key])):'Awaiting confirmed mark')+
        '</span></summary><div class="swt-trait-explanation"><p>'+escape(explanation)+'</p><p><strong>For full marks</strong> '+escape(guide)+'</p></div></details>';
    });
    const complete=!pending&&traits.every(([key])=>valid(key));
    const traitTotal=traits.reduce((sum,[key])=>sum+(valid(key)?scores[key]:0),0);
    const maximum=traits.reduce((sum,[key])=>sum+(valid(key)?maxima[key]:0),0);
    const total=Number.isFinite(awardedTotal)&&awardedTotal>=0&&awardedTotal<=maximum?awardedTotal:traitTotal;
    entries.push('<div class="swt-trait-tile total"><div><strong>Total</strong><span class="swt-trait-value">'+
      (complete?number(total)+' / '+number(maximum):'—')+'</span><span>'+
      (complete?(gated?'Item rule applied':status(total,maximum)):'Awaiting confirmed mark')+'</span></div></div>');
    return '<div class="swt-trait-review" aria-label="SWT score breakdown">'+entries.join('')+'</div>';
  }
  return {render};
});
