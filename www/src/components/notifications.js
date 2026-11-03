/* notifications.js — the bell screen, shared by all three roles. */
(function () {
  'use strict';
  const TF = window.TF;
  const { esc } = TF.utils;

  TF.components.notifications = (role) => `<div>${TF.state.NT[role].map((n, i) => `
    <div class="card" style="${i === 0 ? 'border:2px solid var(--c)' : ''}">
      <div class="row"><b>${esc(n[0])}</b><span class="chip">${esc(n[1])}</span></div>
      <div class="mu" style="margin-top:6px">${esc(n[2])}</div>
    </div>`).join('')}</div>`;
})();
