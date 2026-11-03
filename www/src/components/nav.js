/* nav.js — bottom tab bar. */
(function () {
  'use strict';
  const TF = window.TF;

  TF.components.nav = (role, activeTab, notifOpen) => `<nav class="nv" aria-label="Main">
    ${TF.data.TABS[role].map(([id, label, icon]) => {
      const on = activeTab === id && !notifOpen;
      return `<button class="${on ? 'on' : ''}" data-action="tab" data-v="${id}" ${on ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</button>`;
    }).join('')}
  </nav>`;
})();
