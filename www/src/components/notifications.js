/* notifications.js — the bell screen, shared by all three roles. */
(function () {
  'use strict';
  const TF = window.TF;
  const { esc, rel } = TF.utils;

  TF.components.notifications = (role) => `<div>${TF.notifs(role).map((n) => `
    <div class="card" style="${n[3] ? 'border:2px solid var(--c)' : ''}">
      <div class="row"><b>${esc(n[0])}</b><span class="chip">${rel(n[1])}</span></div>
      <div class="mu" style="margin-top:6px">${esc(n[2])}</div>
    </div>`).join('') || '<p class="mu">No notifications yet.</p>'}</div>`;
})();
