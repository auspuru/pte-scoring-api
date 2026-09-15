'use strict';
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors=['#315bba','#c6638e','#129185','#ca812d','#745bb0'];
function render(v) {
  const text=(x,y,value,size=18,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" ${extra}>${esc(value)}</text>`;
  let chart='';
  if(v.kind==='bar') {
    v.labels.forEach((label,i)=>{const y=138+i*70;chart+=text(35,y+27,label)+`<rect x="190" y="${y}" width="${v.values[i]*10}" height="42" rx="5" fill="${colors[i]}"/>`+text(207+v.values[i]*10,y+27,v.values[i]+'%');});
  } else if(v.kind==='pie') {
    let angle=-Math.PI/2;
    v.values.forEach((value,i)=>{const next=angle+value/100*2*Math.PI,x=230+135*Math.cos(angle),y=270+135*Math.sin(angle),nx=230+135*Math.cos(next),ny=270+135*Math.sin(next);
      chart+=`<path d="M230 270 L${x} ${y} A135 135 0 ${value>50?1:0} 1 ${nx} ${ny} Z" fill="${colors[i]}" stroke="white" stroke-width="3"/><rect x="425" y="${155+i*49}" width="20" height="20" rx="3" fill="${colors[i]}"/>`+text(460,172+i*49,v.labels[i]+' — '+value+'%',17);angle=next;});
  } else if(v.kind==='line') {
    for(let n=0;n<=500;n+=100){const y=410-n*.55;chart+=`<path d="M90 ${y}H675" stroke="#dde3ee"/>`+text(40,y+6,n,15);}
    const points=v.values.map((n,i)=>`${110+i*130},${410-n*.55}`);
    chart+=`<polyline points="${points.join(' ')}" fill="none" stroke="${colors[0]}" stroke-width="4"/>`;
    v.values.forEach((n,i)=>{const x=110+i*130,y=410-n*.55;chart+=`<circle cx="${x}" cy="${y}" r="6" fill="${colors[0]}"/>`+text(x,y-15,n,17,'text-anchor="middle"')+text(x,440,v.labels[i],16,'text-anchor="middle"');});
  } else if(v.kind==='table') {
    const rows=[v.columns,...v.rows];rows.forEach((row,i)=>{chart+=`<rect x="70" y="${125+i*60}" width="590" height="60" fill="${i===0?'#e6edf9':i%2?'#f5f7fb':'white'}" stroke="#d9e1ee"/>`;row.forEach((cell,j)=>chart+=text([95,365,535][j],163+i*60,cell,19));});
  } else {
    v.steps.forEach((step,i)=>{const y=111+i*65;chart+=`<rect x="155" y="${y}" width="420" height="44" rx="8" fill="${i%2?'#e8f3f0':'#e6edf9'}" stroke="#bdd0e3"/>`+text(365,y+28,step,18,'text-anchor="middle"');if(i<4)chart+=`<path d="M365 ${y+45}v13m-5-5 5 5 5-5" fill="none" stroke="#506380" stroke-width="2"/>`;});
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 730 500" role="img" aria-labelledby="title desc"><title id="title">${esc(v.title)}</title><desc id="desc">${esc(v.subtitle)}. Original illustrative practice data.</desc><rect width="730" height="500" rx="16" fill="white"/><g fill="#203047" font-family="Arial,sans-serif">${text(365,45,v.title,25,'text-anchor="middle" font-weight="bold"')}${text(365,77,v.subtitle,16,'text-anchor="middle"')}${chart}${text(365,483,'Illustrative data created for practice',12,'text-anchor="middle" fill="#627088"')}</g></svg>`;
}
module.exports={render};
