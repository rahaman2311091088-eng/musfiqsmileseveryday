/* DDU Research Edition: progressive enhancement, motion and accessible navigation.
   Compound resolution, prediction import and provider calls live in their own modules. */
(function () {
  'use strict';
  const html = document.documentElement;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const getLocal = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const setLocal = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Appearance is optional. */ } };
  let userPaused = getLocal('ddu_motion') === 'off';
  const reducedMotion = () => userPaused || media.matches;

  function updateMotion() {
    const paused = reducedMotion();
    html.classList.toggle('motion-paused', paused);
    document.querySelectorAll('[data-motion-toggle]').forEach(button => {
      button.textContent = media.matches ? 'Motion: reduced' : paused ? 'Motion: off' : 'Motion: on';
      button.setAttribute('aria-pressed', String(paused));
      button.setAttribute('aria-label', media.matches ? 'Reduced motion follows your system preference' : paused ? 'Turn on interface animations' : 'Turn off interface animations');
      button.disabled = media.matches;
    });
    if (paused) document.querySelectorAll('[data-reveal]').forEach(element => element.classList.add('is-visible'));
  }
  updateMotion();
  media.addEventListener?.('change', updateMotion);
  document.querySelectorAll('[data-motion-toggle]').forEach(button => button.addEventListener('click', () => {
    userPaused = !userPaused;
    setLocal('ddu_motion', userPaused ? 'off' : 'on');
    updateMotion();
  }));

  // Content remains visible without JS or IntersectionObserver. Reveals run once.
  if ('IntersectionObserver' in window && !reducedMotion()) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -15px 0px' });
    document.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
    html.classList.add('js-motion');
  }

  const panels = new Set(['dashboardPanel', 'pubchemTab', 'admetTab', 'dockingPanel']);
  document.querySelectorAll('[data-open-auth]').forEach(button => button.addEventListener('click', () => {
    document.getElementById('landingSignIn')?.click();
  }));
  document.querySelectorAll('[data-open-panel]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    if (!panels.has(link.dataset.openPanel)) return;
    if (document.getElementById('appScreen')?.classList.contains('active')) {
      window.setActivePanel?.(link.dataset.openPanel);
    } else {
      window.dduRequestedPanel = link.dataset.openPanel;
      document.getElementById('landingSignIn')?.click();
    }
  }));
  document.querySelectorAll('[data-workbench-home]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    window.setActivePanel?.('dashboardPanel');
  }));
  document.querySelectorAll('[data-sign-out]').forEach(button => button.addEventListener('click', () => document.getElementById('signOutBtn')?.click()));
  document.querySelectorAll('[data-open-shortcuts]').forEach(button => button.addEventListener('click', () => document.getElementById('kbdPanel')?.classList.add('open')));
  document.querySelectorAll('.auth-glass input').forEach(input => input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      document.getElementById('authSubmit')?.click();
    }
  }));

  const date = document.getElementById('workspaceDate');
  if (date) {
    const now = new Date();
    date.dateTime = now.toISOString().slice(0, 10);
    date.textContent = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  }
  const shortcut = document.querySelector('#cmdTrigger kbd');
  if (shortcut) shortcut.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';

  // Dialog focus stays inside the visible dialog and returns to its opener.
  const dialogs = [...document.querySelectorAll('.cmd-palette, .kbd-panel, .modal-overlay')];
  const labels = { cmdPalette: 'Workspace commands', kbdPanel: 'Keyboard shortcuts', compareModal: 'Compound comparison', statsModal: 'Batch statistics', exportModal: 'Export progress' };
  let lastOutsideFocus = document.activeElement;
  document.addEventListener('focusin', event => {
    if (!dialogs.some(dialog => dialog.contains(event.target))) lastOutsideFocus = event.target;
  });
  const focusables = dialog => [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  dialogs.forEach(dialog => {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', labels[dialog.id] || 'Research details');
    dialog.setAttribute('aria-hidden', 'true');
    let open = false, returnFocus = null;
    const card = dialog.firstElementChild;
    card.tabIndex = -1;
    new MutationObserver(() => {
      const next = dialog.classList.contains('open');
      if (next === open) return;
      open = next;
      dialog.setAttribute('aria-hidden', String(!open));
      if (open) {
        returnFocus = lastOutsideFocus;
        if (!dialog.contains(document.activeElement)) (focusables(dialog)[0] || card).focus({ preventScroll: true });
      } else if (!dialogs.some(other => other.classList.contains('open')) && (dialog.contains(document.activeElement) || document.activeElement === document.body)) {
        if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
      }
    }).observe(dialog, { attributes: true, attributeFilter: ['class'] });
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
    document.getElementById(button.dataset.closeDialog)?.classList.remove('open');
  }));
  document.addEventListener('keydown', event => {
    const dialog = dialogs.filter(item => item.classList.contains('open')).at(-1);
    if (!dialog) return;
    if (event.key === 'Escape' && dialog.id !== 'exportModal') dialog.classList.remove('open');
    if (event.key !== 'Tab') return;
    const items = focusables(dialog);
    if (!items.length) { event.preventDefault(); dialog.firstElementChild.focus(); return; }
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }, true);

  // A compact local log of real completed actions; never store molecule content here.
  const activityKey = 'ddu_recent_activity_v1';
  function activity() {
    try {
      const rows = JSON.parse(getLocal(activityKey) || '[]');
      return Array.isArray(rows) ? rows.filter(row => row && ['lookup', 'docking', 'report'].includes(row.type) && typeof row.label === 'string' && row.label.length <= 160 && typeof row.at === 'string' && Number.isFinite(Date.parse(row.at))).slice(0, 5) : [];
    } catch { return []; }
  }
  function renderActivity() {
    const root = document.getElementById('recentActivity');
    const rows = activity();
    if (!root || !rows.length) return;
    root.replaceChildren();
    root.classList.add('activity-list');
    rows.slice(0, 3).forEach(row => {
      const item = document.createElement('div'); item.className = 'activity-item';
      const mark = document.createElement('span'); mark.className = 'activity-mark'; mark.textContent = row.type === 'lookup' ? '01' : row.type === 'docking' ? '03' : '↗'; mark.setAttribute('aria-hidden', 'true');
      const body = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = row.label;
      const when = document.createElement('time'); when.dateTime = row.at; when.textContent = new Date(row.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      body.append(title, when); item.append(mark, body); root.append(item);
    });
  }
  function recordActivity(type, label) {
    if (!['lookup', 'docking', 'report'].includes(type) || typeof label !== 'string') return;
    setLocal(activityKey, JSON.stringify([{ type, label: label.slice(0, 160), at: new Date().toISOString() }, ...activity()].slice(0, 5)));
    renderActivity();
  }
  window.DduSite = { reducedMotion, renderActivity, recordActivity };
  renderActivity();
})();
