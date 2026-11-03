/* receptionist.js — Register, Priority, Queue, Staff, Rooms, Reassign and Summary. */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state;
  const { esc, fmt, wc, roomLabel, pad2, getPath } = TF.utils;
  const { PC, SYM } = TF.data;
  const { pill } = TF.components;

  const input = (label, id, model, opts = {}) => `<label for="${id}">${label}</label>
    <input id="${id}" data-model="${model}" value="${esc(getPath(S, model))}" placeholder="${esc(opts.ph || '')}" ${opts.type ? `type="${opts.type}"` : ''} ${opts.extra || ''}>`;

  function register() {
    return `<div class="card">
      ${input('Full name', 'f1', 'f.n', { ph: 'Enter patient name', extra: 'autocomplete="off"' })}
      ${input('Age', 'f2', 'f.a', { ph: 'Enter age', type: 'number', extra: 'min="0" max="120" inputmode="numeric"' })}
      ${input('Complaint', 'f3', 'f.c', { ph: 'Enter complaint' })}
      ${input('Diagnosis (illness), optional', 'f4', 'f.dx', { ph: 'e.g. Angina' })}
      ${S.err ? `<p class="form-err" role="alert">${esc(S.err)}</p>` : ''}
      <button class="btn" data-action="reg-next">Next: Set Priority</button></div>`;
  }

  function priority() {
    return `<div class="card"><b>Triage checklist</b><p class="mu">Review symptoms before assigning a priority level.</p>
      ${SYM.map((s, i) => {
        const on = S.chk.includes(i);
        return `<button class="opt ${on ? 'on' : ''}" role="checkbox" aria-checked="${on}" data-action="chk" data-i="${i}">${on ? '☑' : '☐'} ${s}</button>`;
      }).join('')}
      <b>Priority decision:</b>
      <div class="sw" style="margin:8px 0" role="group" aria-label="Priority level">${[1, 2, 3, 4, 5].map((n) =>
        `<button style="background:${S.pri === n ? PC[n] : 'var(--card)'};color:${S.pri === n ? '#fff' : PC[n]};border-color:${PC[n]}" aria-pressed="${S.pri === n}" data-action="pri" data-v="${n}">P${n}</button>`).join('')}</div>
      <button class="btn" data-action="confirm-queue">Confirm and queue</button></div>`;
  }

  function queue() {
    const list = TF.patients.active().sort((a, b) => a.p - b.p || b.w - a.w);
    return list.map((p) => `<div class="card">
      <div class="row"><span>${pill(p)} <b style="margin-left:6px">${esc(p.n)}</b></span>
        <button class="chip" data-action="reassign-patient" data-id="${p.id}">Reassign</button></div>
      <div class="row" style="margin-top:10px"><span class="mu">Doctor: ${esc(p.doc)}<br>Nurse: ${esc(p.nu)}</span>
        <span><span class="chip">${roomLabel(p.room)}</span> <span class="chip ${wc(p.w)}" data-t="${p.id}">${fmt(p.w)}</span></span></div></div>`).join('')
      || '<p class="mu">The queue is empty. Register a patient to begin.</p>';
  }

  function staff() {
    const group = (h, l) => `<b>${h}</b><div class="sec">${l.map((x) => `<div class="card row" style="margin:0 0 8px">
      <span>${x[2] ? '🟢' : '🔴'} <b>${x[0]}</b><div class="mu">${x[1]}</div></span><span class="chip ${x[2] ? 'g' : 'r'}">${x[2] ? 'Free' : 'Busy'}</span></div>`).join('')}</div>`;
    return `<p class="mu">View only · Staff are assigned automatically.</p>${group('Doctors', TF.staff.docs())}${group('Nurses', TF.staff.nurses())}`;
  }

  function rooms() {
    const act = TF.patients.active();
    return `<div class="grid">${[1, 2, 3, 4, 5, 6].map((n) => {
      const o = act.find((p) => p.room == n);
      return `<button class="rm ${o ? '' : 'free'} ${S.room == n ? 'on' : ''}" data-action="room" data-v="${n}" aria-pressed="${S.room == n}">
        <span class="tag ${o ? 'r' : 'g'}">${o ? 'Occupied' : 'Available'}</span><b>${pad2(n)}</b>
        <div class="b" style="margin-top:6px">Room ${n}</div><div class="mu">${o ? esc(o.n) : 'Ready for admission'}</div></button>`;
    }).join('')}</div>
    <div class="grid"><button class="btn gr" data-action="room-assign" data-v="0">Assign</button><button class="btn dk" data-action="room-assign" data-v="1">Move</button></div>
    <p class="mu">Select an available room. Assign puts the next patient without a room into it. Move puts the patient chosen in Reassign or Queue into it.</p>`;
  }

  function reassign() {
    const p = TF.patients.byId(S.sel) || TF.patients.active().slice(-1)[0];
    if (!p) return '<p class="mu">No patients to reassign.</p>';
    S.sel = p.id;
    const opts = (list, key) => list.map((x) => {
      const on = S[key] === x[0];
      return `<button class="opt ${on ? 'on' : ''}" data-action="pick" data-k="${key}" data-v="${esc(x[0])}" ${x[2] ? '' : 'disabled'} aria-pressed="${on}">
        ${x[2] ? '🟢' : '🔴'} ${esc(x[0])} ${x[2] ? '(0 patients)' : '(Busy)'}${on ? ' ✓' : ''}</button>`;
    }).join('');
    return `<div class="card">${pill(p)} <b style="margin-left:6px;font-size:17px">${esc(p.n)}</b>
      <div class="mu" style="margin-top:8px">Current staff<br>${esc(p.doc)} · ${esc(p.nu)}</div></div>
      <b>Choose doctor</b><div class="sec">${opts(TF.staff.docs(), 'rd')}</div>
      <b>Choose nurse</b><div class="sec">${opts(TF.staff.nurses(), 'rn')}</div>
      <button class="btn" data-action="confirm-reassign">Confirm reassignment</button>`;
  }

  function summary() {
    const stats = [[48 + S.added, 'Patients'], ['23m', 'Avg wait'], [9 + S.adm, 'Admitted'], [31 + S.dis, 'Discharge']];
    return `<div class="grid">${stats.map((x) => `<div class="card" style="margin:0"><div class="big">${x[0]}</div><div class="mu" style="text-align:center">${x[1]}</div></div>`).join('')}</div>
      <div class="card" style="margin-top:10px;text-align:center">Shift: 6:00 AM - 2:00 PM</div>
      <button class="btn" data-action="export">Export Summary</button>
      <button class="btn dk" data-action="reset-demo">Reset demo data</button>`;
  }

  TF.components.receptionist = (tab, sub) => {
    if (tab === 'register') return sub === 'priority' ? priority() : register();
    return ({ queue, staff, rooms, reassign, summary }[tab] || (() => ''))();
  };
})();
