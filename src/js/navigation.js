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
  const toolbar = document.getElementById('notes-toolbar');
  const fontSize = document.getElementById('notes-font-size');
  const status = document.getElementById('notes-save-status');
  const key = 'music-practice-player:notes:v1';
  const sync = window.PracticeSync;
  let savedRange = null;
  let rendered = null;
  const maxNoteLength = 30000;
  function cleanHTML(html) {
    const source = new DOMParser().parseFromString(html, 'text/html');
    const target = document.createElement('div');
    function copyNodes(from, to) {
      for (const node of from.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) { to.append(document.createTextNode(node.textContent)); continue; }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = node.tagName.toLowerCase();
        if (['script', 'style', 'iframe', 'object', 'svg', 'math'].includes(tag)) continue;
        if (tag === 'br') { to.append(document.createElement('br')); continue; }
        let name = { b: 'strong', i: 'em', font: 'span' }[tag] || tag;
        if (!['strong', 'em', 'u', 'div', 'p', 'span'].includes(name)) { copyNodes(node, to); continue; }
        const safe = document.createElement(name);
        const size = tag === 'font' ? node.getAttribute('size') : node.className.match(/(?:^|\s)note-size-([245])(?:\s|$)/)?.[1];
        if (name === 'span' && ['2', '4', '5'].includes(size)) safe.className = `note-size-${size}`;
        copyNodes(node, safe);
        to.append(safe);
      }
    }
    copyNodes(source.body, target);
    return target.innerHTML;
  }
  function showNotes(value) {
    if (value && typeof value === 'object' && value.format === 'html-v1') notes.innerHTML = cleanHTML(value.html || '');
    else notes.textContent = typeof value === 'string' ? value : '';
    rendered = JSON.stringify(value);
    savedRange = null;
  }
  function currentNotes() { return { format: 'html-v1', html: cleanHTML(notes.innerHTML) }; }
  function saveNotes() {
    const value = currentNotes();
    if (value.html.length > maxNoteLength) { status.textContent = 'Note is too long to save. Shorten it before leaving.'; return; }
    try {
      if (sync.owner === 'guest') localStorage.setItem(key, JSON.stringify(value));
      rendered = JSON.stringify(value);
      sync.put('notes', value);
      status.textContent = sync.state().error || (sync.owner === 'guest' ? 'Saved on this device.' : 'Saved locally. Sync pending.');
    } catch { status.textContent = 'Could not save. Keep this page open and copy your notes before leaving.'; }
  }
  function restoreSelection() {
    notes.focus({ preventScroll: true });
    if (savedRange && notes.contains(savedRange.commonAncestorContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(savedRange);
    }
  }
  try {
    if (sync.owner === 'guest' && !sync.has('notes')) {
      const old = localStorage.getItem(key) || '';
      let value = old;
      try { const parsed = JSON.parse(old); if (parsed?.format === 'html-v1') value = parsed; } catch {}
      sync.put('notes', value);
    }
    showNotes(sync.get('notes', ''));
  }
  catch { status.textContent = 'Saved notes could not be loaded. Storage is unavailable.'; }
  notes.addEventListener('input', saveNotes);
  notes.addEventListener('paste', event => {
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  });
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (selection.rangeCount && notes.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
  });
  toolbar.addEventListener('pointerdown', event => { if (event.target.closest('button')) event.preventDefault(); });
  toolbar.addEventListener('click', event => {
    const command = event.target.closest('[data-note-command]')?.dataset.noteCommand;
    if (!command) return;
    restoreSelection(); document.execCommand(command, false); saveNotes();
  });
  fontSize.addEventListener('change', () => {
    restoreSelection(); document.execCommand('fontSize', false, fontSize.value); saveNotes(); fontSize.value = '3';
  });
  function renderNotes() {
    const value = sync.get('notes', '');
    if (rendered !== JSON.stringify(value)) showNotes(value);
    const state = sync.state();
    status.textContent = state.error || (state.conflicts.some(c => c.key === 'notes') ? 'Two versions preserved. Review them in Configurations.'
      : state.owner === 'guest' ? 'Saved on this device.' : state.pending || !state.connected ? 'Saved locally. Sync pending.' : 'Saved and synced.');
  }
  document.addEventListener('syncchange', renderNotes);
  document.addEventListener('syncaccountchange', renderNotes);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const active = document.activeElement;
    if (!active?.matches('input, select, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    active.blur();
    document.body.tabIndex = -1;
    document.body.focus({ preventScroll: true });
  });
})();
