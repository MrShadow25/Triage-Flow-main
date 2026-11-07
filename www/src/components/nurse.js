/* nurse.js — Patients / Task / Status tabs. */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state;
  const { esc, fmt, duePhrase } = TF.utils;
  const { pill, patientCard } = TF.components;

  TF.components.nurse = (tab) => {
    const mine = TF.patients.mine(), me = TF.staff.me() || { st: 'off' };
    const label = me.st === 'available' ? 'Available' : me.st === 'busy' ? 'Busy' : 'Off-duty';

    if (tab === 'patients') {
      return (mine.map((p) => patientCard(p, false)).join('') || '<p class="mu">No patients are assigned to you right now.</p>') +
        `<div class="card">${me.st === 'available' ? '🟢' : '🔴'} Status: ${label}${me.st === 'busy' ? ' with ' + mine.length + ' patient' + (mine.length === 1 ? '' : 's') : ''}</div>`;
    }

    if (tab === 'task') {
      const tasks = S.tasks.filter((t) => t.nurse === S.user.name && TF.patients.byId(t.pid)).sort((a, b) => a.due - b.due);
      const row = (t) => { const p = TF.patients.byId(t.pid), over = t.due <= Date.now(); return `<div class="card row" style="margin-bottom:8px"><span>${pill(p)}
        <span style="margin-left:6px">${esc(t.title)} ${esc(p.n)}<br><span class="mu" data-due="${t.id}">${duePhrase(t.due)}</span></span></span>
        <button class="chip ${over ? 'r' : 'g'}" data-action="task-done" data-id="${t.id}">Done</button></div>`; };
      const soon = tasks.filter((t) => t.due - Date.now() <= 15 * 60000), later = tasks.filter((t) => t.due - Date.now() > 15 * 60000);
      return `<div class="card"><h2 style="margin:0 0 10px;font-size:18px">Re-checks &amp; next tasks</h2>
        <div class="mu" style="margin-bottom:6px">Due now / within 15 minutes</div>${soon.map(row).join('') || '<p class="mu">Nothing due soon.</p>'}
        <div class="mu" style="margin:10px 0 6px">Upcoming tasks</div>${later.map(row).join('') || '<p class="mu">No upcoming tasks.</p>'}</div>`;
    }

    if (tab === 'status') {
      const busy = me.st !== 'available';
      return `<div class="card"><span class="mu">Current status</span>
        <div class="row"><b style="font-size:20px">${label}</b><span class="chip ${busy ? 'r' : 'g'}">${busy ? label : 'Free'}</span></div>
        <p class="mu">${busy ? `You are currently ${label.toLowerCase()} and assigned to ${mine.length} patient${mine.length === 1 ? '' : 's'}.` : 'You are available for the next patient.'}</p></div>
        <button class="btn" data-action="my-status" data-v="${busy ? 'available' : 'busy'}">${busy ? 'Done, mark me available' : 'Mark me busy'}</button>
        <p class="mu" style="text-align:center">The system assigns your next patient once you are available.</p>`;
    }
    return '';
  };
})();
