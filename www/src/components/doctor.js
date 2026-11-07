/* doctor.js — Patients list, patient detail and Availability. */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state;
  const { esc, fmt, roomLabel } = TF.utils;
  const { pill, patientCard } = TF.components;
  const STATUSES = [['available', 'Available', '#16a34a', 'Ready for the next patient'], ['busy', 'Busy', '#dc2626', 'Treating a patient'], ['off', 'Off-duty', '#6b7280', 'No assignment']];
  const SL = { waiting: 'Waiting', in_care: 'Being seen', admitted: 'Admitted' };

  TF.components.doctor = (tab, sub) => {
    if (sub === 'detail') {
      const p = TF.patients.byId(S.sel);
      if (!p) return '';
      const rows = [['Age', p.age == null ? '—' : p.age], ['Complaint', p.c], ['Diagnosis', p.dx], ['Wait time', fmt(TF.patients.wait(p))], ['Room', roomLabel(p.room)], ['Doctor', p.doc || 'Unassigned'], ['Nurse', p.nu || 'Unassigned'], ['Status', SL[p.st] || p.st]]
        .map((x) => `<div class="kv"><span class="mu">${x[0]}</span><b>${esc(x[1])}</b></div>`).join('');
      return `<div class="card">${pill(p)} <b style="margin-left:6px;font-size:17px">${esc(p.n)}</b>${rows}</div>
        <div class="card"><label for="dx">Diagnosis</label><input id="dx" data-model="dxv" value="${esc(S.dxv)}" placeholder="Enter diagnosis">
          <button class="btn dk" style="margin-top:10px" data-action="save-dx">Save diagnosis</button></div>
        <button class="btn" data-action="patient-status" data-v="seen">Mark as seen</button>
        <div class="grid"><button class="btn gr" data-action="patient-status" data-v="admitted">Admit</button>
        <button class="btn dk" data-action="patient-status" data-v="out">Discharge</button></div>`;
    }
    if (tab === 'patients') return TF.patients.mine().sort((a, b) => a.p - b.p || a.t0 - b.t0).map((p) => patientCard(p, true)).join('') || '<p class="mu">No patients are assigned to you right now.</p>';
    if (tab === 'avail') {
      const me = TF.staff.me() || { st: 'off' }, cur = STATUSES.find((x) => x[0] === me.st) || STATUSES[2];
      return `<div class="card"><span class="mu">Current status</span>
        <div class="row"><b style="font-size:20px">${cur[1]}</b><span class="chip ${me.st === 'available' ? 'g' : 'r'}">${me.st === 'available' ? 'Ready now' : cur[1]}</span></div></div>
        <b>Choose status</b><p class="mu">Select the state that best matches your current workflow.</p>
        ${STATUSES.map((x) => `<button class="opt ${me.st === x[0] ? 'on' : ''}" data-action="my-status" data-v="${x[0]}" aria-pressed="${me.st === x[0]}">
          <span class="dot" style="background:${x[2]}"></span><span><b>${x[1]}</b><br><span class="mu">${x[3]}</span></span></button>`).join('')}`;
    }
    return '';
  };
})();
