'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, reportHTML } = require('../public/portal-exam-mode');

function harness() {
  const events = new Map();
  const doc = { activeElement:null,hidden:false,focused:true,hasFocus(){return this.focused;},addEventListener:(type,handler)=>events.set(type,handler) }, nodes = new Map();
  function node(id, parent, tagName='DIV') {
    const attrs = new Map(), classes = new Set();
    const value = { id, tagName, parentElement:parent, children:[], inert:false, hidden:false, value:'',selectionStart:0,selectionEnd:0,events:{},
      classList:{ add:name=>classes.add(name), remove:name=>classes.delete(name), contains:name=>classes.has(name) },
      getAttribute:name=>attrs.get(name)??null, setAttribute:(name,value)=>attrs.set(name,value), removeAttribute:name=>attrs.delete(name),
      contains(target) { return target===this || this.children.some(child=>child.contains(target)); },
      focus() { doc.activeElement=this; },
      appendChild(child){child.parentElement=this;this.children.push(child);},
      showModal(){this.open=true;},close(){this.open=false;},
      dispatchEvent(event){this.events[event.type]?.(event);},
      setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.selectionStart=this.selectionEnd=start+text.length;}
    };
    parent?.children.push(value); nodes.set(id,value); return value;
  }
  const html=node('html'),body=node('body',html); doc.body=body; doc.documentElement=html; doc.getElementById=id=>nodes.get(id);
  doc.createElement=tag=>node('',null,tag.toUpperCase());
  html.requestFullscreen=async()=>{doc.fullscreenElement=html;events.get('fullscreenchange')?.();};
  doc.exitFullscreen=async()=>{doc.fullscreenElement=null;events.get('fullscreenchange')?.();};
  const shell=node('appShell',body), sidebar=node('portalSidebar',shell), main=node('main',shell);
  const topbar=node('topbar',main), panes=node('panes',main), reading=node('readingPane',panes), writing=node('writingLabScreen',panes);
  const assistant=node('personalAiAssistant',body);
  let update;
  const win={addEventListener:(type,handler)=>events.set(type,handler),Event:class {constructor(type){this.type=type;}},MutationObserver:class {constructor(callback){update=callback;} observe(){} disconnect(){}}};
  const fire=(type,extra={})=>{const event={preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};events.get(type)?.(event);return event;};
  return {mode:createController(doc,win),doc,node,nodes,body,shell,sidebar,main,topbar,panes,reading,writing,assistant,fire,update:()=>update(),guard:()=>body.children.find(n=>n.id==='portal-exam-guard')};
}

test('An active mock hides every outside branch and removes portal controls from keyboard navigation', () => {
  const h=harness(); h.doc.activeElement=h.assistant;
  h.mode.set('reading',true,h.reading);
  assert(h.mode.isActive());
  assert(h.body.classList.contains('portal-exam-active'));
  assert.equal(h.doc.activeElement,h.reading);
  for(const node of [h.sidebar,h.topbar,h.writing,h.assistant]) {
    assert.equal(node.getAttribute('data-exam-blocked'),''); assert.equal(node.inert,true);
  }
  for(const node of [h.reading,h.panes,h.main,h.shell]) assert.equal(node.getAttribute('data-exam-blocked'),null);
  const next=h.node('next',h.reading,'BUTTON'); assert.equal(next.inert,false);
  const late=h.node('late-assistant',h.body); h.update();
  assert.equal(late.getAttribute('data-exam-blocked'),''); assert.equal(late.inert,true);
});

test('Submission restores prior accessibility and hidden states without an unrelated runner releasing the mock', () => {
  const h=harness(); h.sidebar.inert=true; h.writing.hidden=true;
  h.mode.set('reading',true,h.reading); h.mode.set('writing',false);
  assert(h.mode.isActive());
  h.mode.set('reading',false);
  assert(!h.mode.isActive()); assert.equal(h.sidebar.inert,true); assert.equal(h.writing.hidden,true);
  for(const node of [h.topbar,h.writing,h.assistant]) {
    assert.equal(node.inert,false); assert.equal(node.getAttribute('data-exam-blocked'),null);
  }
  assert.equal(h.reading.getAttribute('tabindex'),null);
  assert(!h.body.classList.contains('portal-exam-active'));
});

test('Writing mock confirmation and saving notices remain usable within the exam pane', () => {
  const h=harness(),dialog=h.node('confirm-dialog',h.writing,'DIALOG'),notice=h.node('notice',h.writing);
  h.mode.set('writing',true,h.writing);
  assert.equal(h.reading.inert,true); assert.equal(h.assistant.inert,true);
  assert.equal(dialog.inert,false); assert.equal(notice.inert,false);
  h.mode.reset(); assert(!h.mode.isActive()); assert.equal(h.assistant.inert,false);
});

test('Standalone Writing Lab preserves its final submission dialog and existing focus target', () => {
  const h=harness(),lab=h.node('lab',h.body),dialog=h.node('confirm-dialog',h.body,'DIALOG'),notice=h.node('notice',h.body);
  lab.setAttribute('tabindex','-1'); h.mode.set('writing',true,lab);
  assert.equal(dialog.inert,false); assert.equal(notice.inert,false); assert.equal(h.assistant.inert,true);
  h.mode.set('writing',false); assert.equal(lab.getAttribute('tabindex'),'-1');
});

test('Fullscreen preflight holds the questions until the runner starts and may be cancelled before starting', async () => {
  const h=harness(),ready=h.mode.prepare('reading',h.reading),guard=h.guard(),buttons=guard.children[0].children.filter(n=>n.tagName==='BUTTON');
  assert(h.mode.isLocked());assert(h.reading.inert);assert(guard.open);
  await buttons[0].onclick();assert.equal(await ready,true);
  assert.equal(h.doc.fullscreenElement,h.doc.documentElement);assert(guard.open);assert(h.reading.inert);
  h.mode.set('reading',true,h.reading,{onEvent(){}});
  assert(!h.mode.isLocked());assert(!guard.open);assert(!h.reading.inert);
  h.mode.reset();assert.equal(h.doc.fullscreenElement,null);
  const second=h.mode.prepare('reading',h.reading);buttons[1].onclick();assert.equal(await second,false);assert(!h.mode.isActive());
});

test('Tab or window departures lock the questions, record one interruption and require an explicit fullscreen return', async () => {
  const h=harness(),records=[],ready=h.mode.prepare('reading',h.reading);
  const enter=h.guard().children[0].children.find(n=>n.tagName==='BUTTON');await enter.onclick();await ready;
  h.mode.set('reading',true,h.reading,{onEvent:event=>records.push(event)});
  h.doc.focused=false;h.fire('blur');assert(h.mode.isLocked('reading'));assert(h.reading.inert);
  h.doc.hidden=true;h.fire('visibilitychange');h.doc.fullscreenElement=null;h.fire('fullscreenchange');
  assert.equal(records.length,1);assert.equal(records[0].reason,'window-blur');
  h.doc.hidden=false;h.doc.focused=true;h.fire('focus');assert(h.mode.isLocked());
  await enter.onclick();assert(!h.mode.isLocked());assert(!h.reading.inert);assert.equal(h.doc.fullscreenElement,h.doc.documentElement);
  h.doc.fullscreenElement=null;h.fire('fullscreenchange');assert.equal(records.length,2);assert.equal(records[1].reason,'fullscreen-exit');
  h.mode.set('reading',false);assert(!h.reading.inert);assert(!h.guard().open);assert(!h.fire('contextmenu').prevented);
});

test('Unavailable or rejected fullscreen cannot bypass preflight', async () => {
  const h=harness(),ready=h.mode.prepare('writing',h.writing),card=h.guard().children[0],enter=card.children.find(n=>n.tagName==='BUTTON');
  h.doc.documentElement.requestFullscreen=async()=>{throw Error('Fullscreen declined');};
  await enter.onclick();assert(h.mode.isLocked());assert(h.writing.inert);assert.equal(card.children[2].textContent,'Fullscreen declined');
  h.mode.reset();assert.equal(await ready,false);
});

test('Protected copy, cut and paste use only a private clipboard while internal question drag controls remain available', async () => {
  const h=harness(),records=[];h.doc.fullscreenElement=h.doc.documentElement;
  const answer=h.node('answer',h.writing,'TEXTAREA');answer.value='My own words';answer.selectionStart=0;answer.selectionEnd=2;
  let edits=0;answer.events.input=()=>edits++;
  h.mode.set('writing',true,h.writing,{onEvent:event=>records.push(event)});
  assert(h.fire('contextmenu').prevented);
  assert(h.fire('keydown',{key:'t',ctrlKey:true}).prevented);assert(!h.fire('keydown',{key:'c',ctrlKey:true}).prevented);assert(!h.fire('keydown',{key:'Escape'}).prevented);
  assert(h.fire('copy',{target:answer}).prevented);answer.selectionStart=answer.selectionEnd=answer.value.length;
  let read=false;const paste=h.fire('paste',{target:answer,clipboardData:{getData(){read=true;return 'Gemini answer';}}});
  assert(paste.prevented);assert(!read);assert.equal(answer.value,'My own wordsMy');assert.equal(edits,1);
  answer.selectionStart=0;answer.selectionEnd=2;assert(h.mode.edit('cut',answer));assert.equal(answer.value,' own wordsMy');
  h.fire('dragstart',{target:answer});assert(!h.fire('drop',{target:answer}).prevented);
  assert(h.fire('drop',{target:answer}).prevented);assert.equal(records[0].reason,'external-drop-blocked');
  h.mode.reset();h.doc.fullscreenElement=h.doc.documentElement;h.mode.set('writing',true,h.writing,{onEvent:event=>records.push(event)});
  h.fire('paste',{target:answer});assert.equal(records[1].reason,'external-paste-blocked');assert(h.mode.isLocked());
});

test('Interruption reports escape text and retain neutral language without changing scoring', () => {
  assert.equal(reportHTML(null),'');
  const html=reportHTML({protected:true,events:[{reason:'<script>',at:1000}]});
  assert.match(html,/1 recorded interruption/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/do not change the score/);
});
