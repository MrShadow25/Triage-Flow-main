/* nurse.js — Patients / Task / Status tabs. */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state;
  const { esc, fmt } = TF.utils;
  const { pill, patientCard } = TF.components;

  TF.components.nurse = (tab) => {
    const mine = TF.staff.mine();

    if (tab === 'patients') {
      return (mine.map((p) => patientCard(p, false)).join('') || '<p class="mu">No patients are assigned to you right now.</p>') +
        `<div class="card">${S.nbusy ? '🔴' : '🟢'} Status: ${S.nbusy ? 'Busy with ' + mine.length + ' patients' : 'Available'}</div>`;
    }

    if (tab === 'task') {
      const rechecks = mine.map((p) => `<div class="card row" style="margin-bottom:8px"><span>${pill(p)}
        <span style="margin-left:6px">Re-check ${esc(p.n.split(',')[0])}<br><span class="mu">${p.w < 120 ? 'now overdue' : 'due in ' + fmt(p.w)}</span></span></span></div>`).join('');
      const upcoming = [['Emergency vital check', 'P. Jackson · Room 01', '01:00', 'r'], ['Infection check', 'J. Villas · Room 04', '10:00', 'g']]
        .map((x) => `<div class="card row" style="margin-bottom:8px"><span style="font-size:13px"><b>${x[0]}</b><br>${x[1]}</span><span class="chip ${x[3]}">${x[2]}</span></div>`).join('');
      return `<div class="card"><h2 style="margin:0 0 10px;font-size:18px">Rechecks &amp; next tasks</h2>
        <div class="mu" style="margin-bottom:6px">Re-checks</div>${rechecks || '<p class="mu">Nothing to re-check.</p>'}
        <div class="mu" style="margin:10px 0 6px">Upcoming tasks</div>${upcoming}</div>`;
    }

    if (tab === 'status') {
      return `<div class="card"><span class="mu">Current status</span>
        <div class="row"><b style="font-size:20px">${S.nbusy ? 'Busy' : 'Available'}</b><span class="chip ${S.nbusy ? 'r' : 'g'}">${S.nbusy ? 'Busy' : 'Free'}</span></div>
        <p class="mu">You are currently ${S.nbusy ? 'busy and assigned to ' + mine.length + ' patients' : 'available for the next patient'}.</p></div>
        <button class="btn" data-action="toggle-busy">${S.nbusy ? 'Done, mark me available' : 'Mark me busy'}</button>
        <p class="mu" style="text-align:center">The system will assign your next patient once you are available.</p>`;
    }
    return '';
  };
})();
