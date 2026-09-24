(function(){
'use strict';
let activeDialog=null,returnFocus=null,undoTimer=null;
const focusable='button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function prepareModal(overlay,index){if(overlay.dataset.a11yReady)return;overlay.dataset.a11yReady='true';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.tabIndex=-1;const title=overlay.querySelector('h1,h2,h3');if(title){if(!title.id)title.id='portalDialogTitle'+index;overlay.setAttribute('aria-labelledby',title.id);}}
function opened(overlay){prepareModal(overlay,[...document.querySelectorAll('.modal-overlay')].indexOf(overlay)+1);returnFocus=document.activeElement;activeDialog=overlay;requestAnimationFrame(()=>{(overlay.querySelector(focusable)||overlay).focus?.();});}
function closed(overlay){if(activeDialog!==overlay)return;activeDialog=null;const target=returnFocus;returnFocus=null;target?.focus?.();}
function scan(){document.querySelectorAll('.modal-overlay').forEach((overlay,index)=>{prepareModal(overlay,index+1);const was=overlay.dataset.openState==='true',now=overlay.classList.contains('show');overlay.dataset.openState=String(now);if(now&&!was)opened(overlay);else if(!now&&was)closed(overlay);});}
const observer=new MutationObserver(scan);
function trap(ev){if(!activeDialog)return;if(ev.key==='Escape'){ev.preventDefault();const buttons=[...activeDialog.querySelectorAll('button')];const close=buttons.find(b=>/close|cancel|done|back/i.test((b.textContent||'').trim())||/close|cancel/i.test(b.getAttribute?.('onclick')||''));if(close)close.click();else{activeDialog.classList.remove('show');scan();}return;}if(ev.key!=='Tab')return;const nodes=[...activeDialog.querySelectorAll(focusable)].filter(el=>el.offsetParent!==null);if(!nodes.length){ev.preventDefault();return;}const first=nodes[0],last=nodes.at(-1);if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus();}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus();}}
function addPasswordToggles(){document.querySelectorAll('input[type="password"]').forEach(input=>{if(input.dataset.toggleReady)return;input.dataset.toggleReady='true';const b=document.createElement('button');b.type='button';b.className='password-visibility-toggle';b.textContent='Show';b.setAttribute('aria-label','Show password');b.addEventListener('click',()=>{const show=input.type==='password';input.type=show?'text':'password';b.textContent=show?'Hide':'Show';b.setAttribute('aria-label',(show?'Hide':'Show')+' password');});input.insertAdjacentElement('afterend',b);});}
function labelEssayFields(){const labels={f_intro:'Introduction',f_bp1:'Body paragraph 1',f_bp2:'Body paragraph 2',f_concl:'Conclusion'};for(const [id,label] of Object.entries(labels)){const el=document.getElementById(id);if(el&&!el.getAttribute('aria-label'))el.setAttribute('aria-label',label);}}
function portalConfirm(message,{title='Please confirm',confirmLabel='Continue',cancelLabel='Cancel',destructive=false}={}){
  return new Promise(resolve=>{
    let dialog=document.getElementById('portalConfirmDialog');
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='portalConfirmDialog';dialog.className='portal-confirm-dialog';
      dialog.innerHTML='<form method="dialog"><h2 id="portalConfirmTitle"></h2><p id="portalConfirmMessage"></p><div class="dialog-actions"><button type="button" data-portal-cancel></button><button type="button" data-portal-ok></button></div></form>';
      document.body.appendChild(dialog);
    }
    const titleEl=dialog.querySelector('#portalConfirmTitle'),messageEl=dialog.querySelector('#portalConfirmMessage'),ok=dialog.querySelector('[data-portal-ok]'),cancel=dialog.querySelector('[data-portal-cancel]');
    titleEl.textContent=title;messageEl.textContent=String(message||'');ok.textContent=confirmLabel;cancel.textContent=cancelLabel;
    ok.className=destructive?'portal-confirm-danger':'portal-confirm-primary';cancel.className='portal-confirm-cancel';
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;dialog.close();resolve(value);};
    ok.onclick=()=>finish(true);cancel.onclick=()=>finish(false);
    dialog.oncancel=e=>{e.preventDefault();finish(false);};
    dialog.onclose=()=>{if(!settled){settled=true;resolve(false);}};
    dialog.showModal();cancel.focus();
  });
}
window.portalConfirm=portalConfirm;
function undoToast(message,onUndo){const t=document.getElementById('toast');if(!t)return;clearTimeout(undoTimer);t.replaceChildren(document.createTextNode(message+' '));const b=document.createElement('button');b.type='button';b.className='toast-undo';b.textContent='Undo';b.addEventListener('click',()=>{clearTimeout(undoTimer);t.classList.remove('show');onUndo?.();},{once:true});t.appendChild(b);t.classList.remove('error');t.classList.add('show');undoTimer=setTimeout(()=>t.classList.remove('show'),8000);}
function boot(){scan();addPasswordToggles();labelEssayFields();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});}
document.addEventListener('keydown',trap);window.portalUndoToast=undoToast;if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();