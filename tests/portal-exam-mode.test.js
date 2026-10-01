'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../public/portal-exam-mode');

function harness() {
  const doc = { activeElement:null }, nodes = new Map();
  function node(id, parent, tagName='DIV') {
    const attrs = new Map(), classes = new Set();
    const value = { id, tagName, parentElement:parent, children:[], inert:false, hidden:false,
      classList:{ add:name=>classes.add(name), remove:name=>classes.delete(name), contains:name=>classes.has(name) },
      getAttribute:name=>attrs.get(name)??null, setAttribute:(name,value)=>attrs.set(name,value), removeAttribute:name=>attrs.delete(name),
      contains(target) { return target===this || this.children.some(child=>child.contains(target)); },
      focus() { doc.activeElement=this; }
    };
    parent?.children.push(value); nodes.set(id,value); return value;
  }
  const body=node('body'); doc.body=body; doc.getElementById=id=>nodes.get(id);
  const shell=node('appShell',body), sidebar=node('portalSidebar',shell), main=node('main',shell);
  const topbar=node('topbar',main), panes=node('panes',main), reading=node('readingPane',panes), writing=node('writingLabScreen',panes);
  const assistant=node('personalAiAssistant',body);
  let update;
  const win={MutationObserver:class {constructor(callback){update=callback;} observe(){} disconnect(){}}};
  return {mode:createController(doc,win),doc,node,nodes,body,shell,sidebar,main,topbar,panes,reading,writing,assistant,update:()=>update()};
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
