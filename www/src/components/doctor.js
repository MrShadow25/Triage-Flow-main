/* doctor.js — Patients list, patient detail and Availability. */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state;
  const { esc, fmt, roomLabel } = TF.utils;
  const { pill, patientCard } = TF.components;

  const STATUSES = [['Available', '#16a34a', 'Ready for the next patient'], ['Busy', '#dc2626', 'Treating a patient'], ['Off-duty', '#6b7280', 'No assignment']];

  TF.components.doctor = (tab, sub) => {
    if (sub === 'detail') {
      const p = TF.patients.byId(S.sel);
      if (!p) return '';
      const status = p.st === 'waiting' ? 'Waiting' : p.st[0].toUpperCase() + p.st.slice(1);
      const rows = [['Complaint', p.c], ['Diagnosis', p.dx], ['Wait time', fmt(p.w)], ['Room', roomLabel(p.room)], ['Doctor', p.doc], ['Nurse', p.nu], ['Status', status]]
        .map((x) => `<div class="kv"><span class="mu">${x[0]}</span><b>${esc(x[1])}</b></div>`).join('');
      return `<div class="card">${pill(p)} <b style="margin-left:6px;font-size:17px">${esc(p.n)}</b>${rows}</div>
        <button class="btn" data-action="patient-status" data-v="seen">Mark as seen</button>
        <div class="grid"><button class="btn gr" data-action="patient-status" data-v="admitted">Admit</button>
        <button class="btn dk" data-action="patient-status" data-v="out">Discharge</button></div>`;
    }

    if (tab === 'patients') {
      return TF.patients.active().map((p) => patientCard(p, true)).join('') || '<p class="mu">No patients are assigned to you right now.</p>';
    }

    if (tab === 'avail') {
      return `<div class="card"><span class="mu">Current status</span>
        <div class="row"><b style="font-size:20px">${S.dstat}</b><span class="chip ${S.dstat === 'Available' ? 'g' : 'r'}">${S.dstat === 'Available' ? 'Ready now' : S.dstat}</span></div></div>
        <b>Choose status</b><p class="mu">Select the state that best matches your current workflow.</p>
        ${STATUSES.map((x) => `<button class="opt ${S.dstat === x[0] ? 'on' : ''}" data-action="doc-status" data-v="${x[0]}" aria-pressed="${S.dstat === x[0]}">
          <span class="dot" style="background:${x[1]}"></span><span><b>${x[0]}</b><br><span class="mu">${x[2]}</span></span></button>`).join('')}`;
    }
    return '';
  };
})();
