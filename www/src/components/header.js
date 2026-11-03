/* header.js — top bars for the sign-in screens and the signed-in app. */
(function () {
  'use strict';
  const TF = window.TF;
  const { esc } = TF.utils;

  // Plain centred bar used on sign-in / create account / change password.
  const authHeader = (title) => `<header class="center"><h1>${esc(title)}</h1></header>`;

  // Role-coloured bar: Log out (home) or Back, title, notification bell.
  const appHeader = ({ title, back }) => `<header>
    ${back
      ? '<button class="ib" data-action="back" aria-label="Back">←</button>'
      : '<button class="ib" data-action="logout">Log out</button>'}
    <h1>${esc(title)}</h1>
    <button class="ib bell" data-action="bell" aria-label="Notifications">🔔<i></i></button>
  </header>`;

  TF.components.header = { authHeader, appHeader };
})();
