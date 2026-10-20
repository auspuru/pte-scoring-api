(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./practice-catalogue') : root.PracticeCatalogue);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.PracticeStudio = api; api.install(root); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (catalogue) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const routes = new Set(['practice-hub', ...catalogue.groups.flatMap(g => g.tasks.map(t => t.route))]);
  function navigation(skill, active, { disabled = false } = {}) {
    const group = catalogue.groups.find(g => g.id === skill);
    if (!group) return '';
    return '<nav class="practice-studio-taskbar" aria-label="'+esc(group.title)+' tasks">'
      + '<button type="button" class="practice-studio-home" data-studio-route="practice-hub" '+(disabled?'disabled':'')+'>← All practice</button>'
      + '<div class="practice-studio-tasklinks">'+group.tasks.map(task => '<button type="button" data-studio-route="'+esc(task.route)+'" '+(active===task.route?'aria-current="page" ':'')+(disabled?'disabled':'')+'>'+esc(task.label)+'</button>').join('')+'</div></nav>';
  }
  function heading(skill, title, description, badge = '') {
    return '<header class="practice-studio-heading"><div><p class="practice-studio-eyebrow">'+esc(skill)+' practice</p><h2>'+esc(title)+'</h2>'+(description?'<p class="practice-studio-description">'+esc(description)+'</p>':'')+'</div>'+(badge?'<span class="practice-studio-badge">'+esc(badge)+'</span>':'')+'</header>';
  }
  function wrap(skill, active, content) {
    return '<div class="practice-studio">'+navigation(skill, active)+'<div class="practice-studio-content">'+content+'</div></div>';
  }
  function install(env) {
    const doc = env.document;
    if (!doc || doc.__practiceStudioInstalled) return;
    doc.__practiceStudioInstalled = true;
    (doc.querySelectorAll?.('[data-studio-navigation]') || []).forEach(node => {
      node.innerHTML = navigation(node.dataset.studioNavigation, node.dataset.studioActive);
    });
    doc.addEventListener?.('click', event => {
      const button = event.target.closest?.('button[data-studio-route]');
      if (!button || button.disabled || !routes.has(button.dataset.studioRoute)) return;
      env.switchSection?.(button.dataset.studioRoute);
    });
  }
  return { navigation, heading, wrap, install };
});
