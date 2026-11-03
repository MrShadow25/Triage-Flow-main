/* utils.js — small, framework-free helpers shared by every other file. */
(function () {
  'use strict';
  const TF = (window.TF = window.TF || {});
  TF.components = TF.components || {};

  const $ = (sel, root = document) => root.querySelector(sel);

  // Escape anything a user typed before it goes into an HTML template.
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt = (s) => pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); // seconds -> mm:ss
  const wc = (s) => (s < 600 ? 'r' : s < 1800 ? 'y' : 'g');          // wait-time chip colour
  const roomLabel = (r) => (r ? 'Room ' + pad2(r) : 'No room');

  // Read/write a dotted path such as "lf.id" on an object (used for form binding).
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? '' : o[k]), obj) ?? '';
  const setPath = (obj, path, value) => {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
  };

  let toastTimer;
  function toast(msg) {
    const box = $('#toasts');
    clearTimeout(toastTimer);
    box.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.append(el);
    toastTimer = setTimeout(() => el.remove(), 2800);
  }

  // Accepts 09171234567, 9171234567, 639171234567 or +63 917 123 4567 -> "+639171234567" (or null).
  function normalizePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('63')) d = d.slice(2);
    else if (d.startsWith('0')) d = d.slice(1);
    return /^9\d{9}$/.test(d) ? '+63' + d : null;
  }
  const maskPhone = (p) => '+63 9•• ••• ' + p.slice(-4);

  // Cryptographically random 6-digit code.
  function randomCode() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return String(a[0] % 1000000).padStart(6, '0');
  }

  TF.utils = { $, esc, pad2, fmt, wc, roomLabel, getPath, setPath, toast, normalizePhone, maskPhone, randomCode };
})();
