/* patientCard.js — one patient row, used by the nurse and doctor lists. */
(function () {
  'use strict';
  const TF = window.TF;
  const { esc, fmt, wc, roomLabel } = TF.utils;
  const { PC } = TF.data;

  TF.components.pill = (p) => `<span class="pill" style="background:${PC[p.p]}">P${p.p}</span>`;

  // clickable=true renders a button that opens the patient detail (doctor).
  TF.components.patientCard = (p, clickable) => {
    const inner = `
      <span class="row"><span>${TF.components.pill(p)} <b style="margin-left:6px;font-size:16px">${esc(p.n)}</b></span></span>
      <span class="row" style="margin-top:10px">
        <span class="mu">${esc(p.c)}</span>
        <span><span class="chip">${roomLabel(p.room)}</span> <span class="chip ${wc(p.w)}" data-t="${p.id}">${fmt(p.w)}</span></span>
      </span>`;
    return clickable
      ? `<button class="opt block" data-action="open-patient" data-id="${p.id}">${inner}</button>`
      : `<div class="card">${inner}</div>`;
  };
})();
