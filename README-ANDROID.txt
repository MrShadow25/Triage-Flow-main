# Triage-Flow Android wrapper

This package keeps the existing Triage-Flow HTML/CSS/JavaScript interface and wraps it as an Android app with Capacitor.

## Requirements
- Node.js LTS (Node 20 or newer recommended)
- Android Studio with Android SDK installed
- Internet connection for the first dependency installation

## Build the Android project
1. Extract this ZIP.
2. Open the extracted `Triage-Flow-Android` folder in VS Code or a terminal.
3. Run `npm install`.
4. Run `npx cap add android` (only once).
5. Run `npx cap sync android`.
6. Run `npx cap open android` to open the native project in Android Studio.
7. In Android Studio, wait for Gradle sync, select an emulator or connect your Android phone with USB debugging enabled, then press Run.

## After changing the website
Edit files inside `www/`, then run `npx cap sync android` before running the app again.

## Important limitations in the supplied prototype
- The existing data store uses browser LocalStorage; it is not a shared online database.
- The current OTP code is generated locally in JavaScript and is not sent by SMS.
- This package is a starting Android wrapper, not a signed release APK.
- For real users and patient information, add secure server-side authentication, access control, and a proper database before deployment.

## Interactive logic (no PHP / SQL)
The hospital prototype's server logic now lives in `www/src/engine.js` and runs in the browser:
auto-assign (fewest patients, P1-P3 get rooms), staff status + load, timed re-check tasks (P1 15m ... P5 4h),
diagnosis / seen / admit / discharge, room assign/remove, delete patient, computed shift summary (CSV).
Data is saved in localStorage and syncs live between tabs/windows of the same browser.
For several real devices sharing one queue you need a hosted backend (e.g. Firebase or Supabase), not PHP.
