(function(){
'use strict';
const PROD='https://swt.up.railway.app';
const API=location.protocol==='file:'?PROD:'';
function store(key,value){try{localStorage.setItem(key,value);try{sessionStorage.removeItem(key);}catch(_){}return;}catch(_){try{sessionStorage.setItem(key,value);}catch(__){}}}
function error(id,msg){const el=document.getElementById(id);if(el){el.textContent=msg;el.classList.add('show');}}
function clear(id){document.getElementById(id)?.classList.remove('show');}
async function login(ev){
  ev.preventDefault();
  const u=document.getElementById('loginUsername')?.value.trim()||'',password=document.getElementById('loginPassword')?.value||'',btn=document.getElementById('loginSubmitBtn');
  clear('loginError');if(btn){btn.disabled=true;btn.textContent='Signing in…';}
  try{
    const r=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password})});
    const d=await r.json().catch(()=>({}));if(!r.ok||!d.success||!d.token)throw new Error(d.error||'Unable to sign in. Please try again.');
    const uid=String(d.user?.username||u).trim().toLowerCase();store('pte_user_id',uid);store('pte_session_token',d.token);
    const pw=document.getElementById('loginPassword');if(pw)pw.value='';if(btn)btn.textContent='Signed in · Loading workspace…';
    if(typeof window.enterApp==='function')location.reload();
  }catch(e){error('loginError',e.message||'Connection error. Try again.');if(btn){btn.disabled=false;btn.textContent='Sign in';}}
}
async function requestReset(ev){
  ev.preventDefault();const identifier=document.getElementById('forgotUsername')?.value.trim()||'',btn=document.getElementById('forgotStep1Btn');
  clear('forgotPasswordError');if(btn){btn.disabled=true;btn.textContent='Sending…';}
  try{await fetch(API+'/api/auth/email-reset/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier})});const note=document.getElementById('forgotPasswordNotice');if(note)note.textContent='If that account has an email address, a reset link has been sent.';}
  catch(_){error('forgotPasswordError','Unable to request a reset right now. Please try again.');}
  finally{if(btn){btn.disabled=false;btn.textContent='Email reset link';}}
}
async function completeReset(ev){
  ev.preventDefault();const token=new URLSearchParams(location.search).get('reset')||'',password=document.getElementById('emailResetPassword')?.value||'',confirmPassword=document.getElementById('emailResetConfirm')?.value||'',status=document.getElementById('emailResetStatus');
  if(password.length<8){if(status)status.textContent='Use at least 8 characters.';return;}if(password!==confirmPassword){if(status)status.textContent='Passwords do not match.';return;}
  try{
    const r=await fetch(API+'/api/auth/email-reset/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,newPassword:password})}),d=await r.json().catch(()=>({}));
    if(!r.ok||!d.success)throw new Error(d.error||'Reset link is invalid or expired.');
    history.replaceState({},document.title,location.pathname+location.hash);document.getElementById('emailResetForm')?.remove();document.getElementById('loginForm').style.display='block';error('loginError','Password updated. Sign in with your new password.');
  }catch(e){if(status)status.textContent=e.message;}
}
function installResetForm(){
  if(!new URLSearchParams(location.search).get('reset'))return;
  for(const id of ['loginForm','registerForm','forgotPasswordForm']){const el=document.getElementById(id);if(el)el.style.display='none';}
  const card=document.querySelector('.login-card');if(!card)return;const wrap=document.createElement('div');wrap.id='emailResetForm';
  wrap.innerHTML='<h2 class="login-title">Choose a new password</h2><p class="login-sub">Use at least 8 characters.</p><form id="emailResetCompleteForm"><div class="login-field"><label for="emailResetPassword">New password</label><input type="password" id="emailResetPassword" autocomplete="new-password" minlength="8" required></div><div class="login-field"><label for="emailResetConfirm">Confirm new password</label><input type="password" id="emailResetConfirm" autocomplete="new-password" minlength="8" required></div><p id="emailResetStatus" class="login-error show" role="status"></p><button class="login-submit" type="submit">Update password</button></form>';
  card.appendChild(wrap);wrap.querySelector('form').addEventListener('submit',completeReset);
}
function toggleForgot(show){
  const login=document.getElementById('loginForm'),register=document.getElementById('registerForm'),forgot=document.getElementById('forgotPasswordForm');
  if(!login||!forgot)return;
  login.style.display=show?'none':'block';if(register)register.style.display='none';forgot.style.display=show?'block':'none';
  clear('loginError');clear('forgotPasswordError');
  if(show)document.getElementById('forgotUsername')?.focus();
}
function install(){document.getElementById('loginSubmitForm')?.addEventListener('submit',login);document.getElementById('emailResetRequestForm')?.addEventListener('submit',requestReset);installResetForm();}
window.toggleForgotPasswordMode=toggleForgot;
window.PortalAuthBoot={login,requestReset,completeReset,toggleForgot};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();