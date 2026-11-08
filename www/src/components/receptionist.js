/* receptionist.js — Register, Priority, Queue, Staff, Rooms, Reassign and Summary. */
(function () {
  'use strict';
  const TF = window.TF, S = TF.state;
  const { esc, fmt, wc, roomLabel, pad2, getPath } = TF.utils;
  const { PC, PL } = TF.data;
  const { pill } = TF.components;

  const input = (label, id, model, opts = {}) => `<label for="${id}">${label}</label>
    <input id="${id}" data-model="${model}" value="${esc(getPath(S, model))}" placeholder="${esc(opts.ph || '')}" ${opts.type ? `type="${opts.type}"` : ''} ${opts.extra || ''}>`;
  const dot = (st) => (st === 'available' ? '🟢' : st === 'busy' ? '🔴' : '⚪');
  const stLabel = (st) => (st === 'available' ? 'Available' : st === 'busy' ? 'Busy' : 'Off-duty');
  const stCls = (st) => (st === 'available' ? 'g' : st === 'busy' ? 'r' : '');
  const plural = (n) => `${n} patient${n === 1 ? '' : 's'}`;

  function register() {
    return `<div class="card">
      ${input('Full name', 'f1', 'f.n', { ph: 'Enter patient name', extra: 'autocomplete="off"' })}
      ${input('Age', 'f2', 'f.a', { ph: 'Enter age', type: 'number', extra: 'min="0" max="120" inputmode="numeric"' })}
      ${input('Complaint', 'f3', 'f.c', { ph: 'Enter complaint' })}
      ${input('Diagnosis (optional)', 'f4', 'f.dx', { ph: 'e.g. Angina' })}
      ${S.err ? `<p class="form-err" role="alert">${esc(S.err)}</p>` : ''}
      <button class="btn" data-action="reg-next">Next: Set Priority</button></div>`;
  }

  function priority() {
    return `<div class="card"><b>Triage checklist</b><p class="mu">Review symptoms before assigning a priority level.</p>
      ${S.syms.map((s, i) => {
        const on = S.chk.includes(i);
        return `<div style="display:flex;gap:6px"><button class="opt ${on ? 'on' : ''}" role="checkbox" aria-checked="${on}" data-action="chk" data-i="${i}">${on ? '☑' : '☐'} ${esc(s)}</button>
          ${i >= TF.data.SYM.length ? `<button class="chip" style="margin-bottom:8px" data-action="rm-sym" data-i="${i}">Remove</button>` : ''}</div>`;
      }).join('')}
      <div style="display:flex;gap:6px;margin-bottom:10px"><input data-model="newSym" value="${esc(S.newSym)}" placeholder="Add another symptom" maxlength="60"><button class="chip" data-action="add-sym">+ Add</button></div>
      <b>Priority decision:</b>
      <div class="sw" style="margin:8px 0" role="group" aria-label="Priority level">${[1, 2, 3, 4, 5].map((n) =>
        `<button style="background:${S.pri === n ? PC[n] : 'var(--card)'};color:${S.pri === n ? '#fff' : PC[n]};border-color:${PC[n]}" aria-pressed="${S.pri === n}" data-action="pri" data-v="${n}">P${n}</button>`).join('')}</div>
      <p class="mu" style="text-align:center">P${S.pri}: ${PL[S.pri]}</p>
      <button class="btn" data-action="confirm-queue">Confirm and queue</button></div>`;
  }

  function queue() {
    const list = TF.patients.active().sort((a, b) => a.p - b.p || a.t0 - b.t0);
    return list.map((p) => { const w = TF.patients.wait(p); return `<div class="card">
      <div class="row"><span>${pill(p)} <b style="margin-left:6px">${esc(p.n)}</b></span>
        <span><button class="chip" data-action="reassign-patient" data-id="${p.id}">Reassign</button>
        ${['waiting', 'in_care'].includes(p.st) ? `<button class="chip" style="color:#dc2626" data-action="delete-patient" data-id="${p.id}">Delete</button>` : ''}</span></div>
      <div class="row" style="margin-top:10px"><span class="mu">Assigned Doctor: ${esc(p.doc || 'Unassigned')}<br>Medical Specialty: ${esc(p.doc ? TF.staff.spec(p.doc) : 'Not assigned')}<br>Assigned Nurse: ${esc(p.nu || 'Unassigned')}<br>Patient Complaint: ${esc(p.c)}<br>Diagnosis: “${esc(TF.patients.dx(p))}”</span>
        <span><span class="chip">${roomLabel(p.room)}</span> <span class="chip ${wc(w)}" data-t="${p.id}">${fmt(w)}</span></span></div></div>`; }).join('')
      || '<p class="mu">The queue is empty. Register a patient to begin.</p>';
  }

  function staff() {
    const group = (h, l) => `<b>${h}</b><div class="sec">${l.map((s) => `<div class="card row" style="margin:0 0 8px">
      <span>${dot(s.st)} <b>${esc(s.name)}</b><div class="mu">${esc(s.spec)} · ${plural(TF.staff.load(s))}</div></span><span class="chip ${stCls(s.st)}">${stLabel(s.st)}</span></div>`).join('')}</div>`;
    return `<p class="mu">View only · Staff set their own status and new patients are assigned automatically.</p>${group('Doctors', TF.staff.docs())}${group('Nurses', TF.staff.nurses())}`;
  }

  function rooms() {
    const act = TF.patients.active();
    const free = [1, 2, 3, 4, 5, 6].filter((n) => !act.some((p) => p.room == n));
    if (!free.includes(S.room)) S.room = free[0] || null;   // like the prototype: first free room is preselected
    return `<div class="grid">${[1, 2, 3, 4, 5, 6].map((n) => {
      const o = act.find((p) => p.room == n);
      return `<button class="rm ${o ? '' : 'free'} ${S.room == n ? 'on' : ''}" data-action="room" data-v="${n}" ${o ? 'disabled' : ''} aria-pressed="${S.room == n}">
        <span class="tag ${o ? 'r' : 'g'}">${o ? 'Occupied' : 'Available'}</span><b>${pad2(n)}</b>
        <div class="b" style="margin-top:6px">Room ${n}</div><div class="mu">${o ? esc(o.n) : 'Ready for admission'}</div></button>`;
    }).join('')}</div>
    <label for="rp">Patient</label><select id="rp" data-model="rp"><option value="">Select a patient…</option>
      ${act.map((p) => `<option value="${p.id}" ${S.rp == p.id ? 'selected' : ''}>${esc(p.n)} — ${roomLabel(p.room)}</option>`).join('')}</select>
    <div class="grid" style="margin-top:12px"><button class="btn gr" data-action="room-assign">Assign${S.room ? ' Room ' + pad2(S.room) : ''}</button><button class="btn dk" data-action="room-clear">Remove from room</button></div>`;
  }

  function reassign() {
    const p = TF.patients.byId(S.sel);
    if (!p || p.st === 'out') return '<p class="mu">Pick a patient in the Queue and tap Reassign.</p>';
    const opts = (list, key, cur) => list.map((s) => {
      const on = S[key] === s.name, ok = s.st === 'available' || s.name === cur;
      return `<button class="opt ${on ? 'on' : ''}" data-action="pick" data-k="${key}" data-v="${esc(s.name)}" ${ok ? '' : 'disabled'} aria-pressed="${on}">
        ${dot(s.st)} ${esc(s.name)} — ${esc(s.spec)} (${s.st === 'available' ? plural(TF.staff.load(s)) : stLabel(s.st)})${on ? ' ✓' : ''}</button>`;
    }).join('');
    return `<div class="card">${pill(p)} <b style="margin-left:6px;font-size:17px">${esc(p.n)}</b>
      <div class="mu" style="margin-top:8px">Current staff<br>${esc(p.doc || 'Unassigned')} · ${esc(p.nu || 'Unassigned')}</div></div>
      <b>Choose doctor</b><div class="sec">${opts(TF.staff.docs(), 'rd', p.doc)}</div>
      <b>Choose nurse</b><div class="sec">${opts(TF.staff.nurses(), 'rn', p.nu)}</div>
      <button class="btn" data-action="confirm-reassign">Confirm reassignment</button>`;
  }

  function summary() {
    const s = TF.engine.summary();
    return `<div class="grid">${[[s.total, 'Patients'], [s.avg + 'm', 'Avg wait'], [s.admitted, 'Admitted'], [s.out, 'Discharged']].map((x) => `<div class="card" style="margin:0"><div class="big">${x[0]}</div><div class="mu" style="text-align:center">${x[1]}</div></div>`).join('')}</div>
      <div class="card" style="margin-top:10px;text-align:center">Shift: ${s.shift}</div>
      <button class="btn" data-action="export">Export Summary (CSV)</button>
      <button class="btn dk" data-action="reset-demo">Reset demo data</button>`;
  }

  TF.components.receptionist = (tab, sub) => {
    if (tab === 'register') return sub === 'priority' ? priority() : register();
    return ({ queue, staff, rooms, reassign, summary }[tab] || (() => ''))();
  };
})();
