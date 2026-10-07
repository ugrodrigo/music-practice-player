"use strict";

(() => {
  const toggle = document.getElementById('app-menu-toggle');
  const menu = document.getElementById('app-menu');
  const title = document.getElementById('app-mode-title');
  function closeMenu(restoreFocus = false) {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('[aria-pressed="true"]').focus();
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.app-navigation')) closeMenu();
  });
  document.addEventListener('focusin', event => {
    if (!event.target.closest('.app-navigation')) closeMenu();
  });
  document.querySelector('.app-navigation').addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...menu.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
    event.stopPropagation();
  });
  document.addEventListener('appmodechange', () => {
    title.textContent = menu.querySelector('[aria-pressed="true"]').textContent;
    closeMenu(menu.contains(document.activeElement));
  });

  const notes = document.getElementById('notes-text');
  const status = document.getElementById('notes-save-status');
  const key = 'music-practice-player:notes:v1';
  const sync = window.PracticeSync;
  try {
    if (sync.owner === 'guest' && !sync.has('notes')) sync.put('notes', localStorage.getItem(key) || '');
    notes.value = sync.get('notes', '');
  }
  catch { status.textContent = 'Saved notes could not be loaded. Storage is unavailable.'; }
  notes.addEventListener('input', () => {
    try {
      if (sync.owner === 'guest') localStorage.setItem(key, notes.value);
      sync.put('notes', notes.value);
      status.textContent = sync.state().error || (sync.owner === 'guest' ? 'Saved on this device.' : 'Saved locally. Sync pending.');
    } catch { status.textContent = 'Could not save. Keep this page open and copy your notes before leaving.'; }
  });
  function renderNotes() {
    const value = sync.get('notes', '');
    if (notes.value !== value) notes.value = value;
    const state = sync.state();
    status.textContent = state.error || (state.conflicts.some(c => c.key === 'notes') ? 'Two versions preserved. Review them in Configurations.'
      : state.owner === 'guest' ? 'Saved on this device.' : state.pending || !state.connected ? 'Saved locally. Sync pending.' : 'Saved and synced.');
  }
  document.addEventListener('syncchange', renderNotes);
  document.addEventListener('syncaccountchange', renderNotes);
})();
