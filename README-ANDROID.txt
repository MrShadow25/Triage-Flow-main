# Triage-Flow Android wrapper

This package keeps the existing Triage-Flow HTML/CSS/JavaScript interface and wraps it as an Android app with Capacitor.

## Requirements
- Node.js LTS (Node 20 or newer recommended)
- Android Studio with Android SDK installed
- Internet connection for the first dependency installation

## Build the Android project
1. Extract this ZIP.
2. Open the extracted project folder in VS Code or a terminal.
3. Run `npm install`.
4. Run `npx cap add android` (only once).
5. Run `npx cap sync android`.
6. Run `npx cap open android` to open the native project in Android Studio.
7. In Android Studio, wait for Gradle sync, select an emulator or connect your Android phone with USB debugging enabled, then press Run.

## After changing the website
Edit files inside `www/`, then run `npx cap sync android` before running the app again.

## Important limitations
- Needs an internet connection: all data lives in Supabase. Offline phones cannot see or send updates until they reconnect.
- Built and tested at project / demo scale. A real hospital would need security review, audit logs, backups and privacy-law compliance.
- Not a signed release APK.

## Shared live data
Patients, rooms, tasks, notifications and staff status are stored in Supabase and pushed live to every signed-in phone (realtime, plus a 15 s safety refresh).
Auto-assign (fewest patients, P1-P3 get rooms), discharge/admit and re-check scheduling run inside the database, so two phones cannot double-assign a patient or a room.
Doctors and nurses only see their own patients; receptionists see everyone. The database enforces this, not just the screens.

## Backend (Supabase)
Setup, once: create a Supabase project, turn OFF "Confirm email", run backend/schema.sql, backend/schema-stage2.sql and backend/schema-stage3.sql (in that order) in the SQL Editor,
and put the project URL and publishable key in www/src/supabase-config.js. Never put the secret/service_role key in the app.
- Staff ID + password sign in through Supabase Auth (passwords are hashed by Supabase). Each Staff ID maps to a login like dr-2001@triageflow.app.
- Create account needs the hospital code, which is checked on the server (change it in the app_secrets table). Staff ID format must match the role (REC-/RN-/DR-).
- Two-factor: authenticator app (Google/Microsoft Authenticator), verified by the server. Data is blocked by database rules until 2FA is passed.
- Recovery codes: 8 one-time codes shown once at set-up. A code lets a person who lost their phone link a new authenticator, or reset a forgotten password.
- Forgot password: Staff ID + hospital code + one recovery code. Wrong tries lock the reset for 5 minutes (enforced in the database). Existing sessions are signed out.
- Sign-in lockout: 5 wrong passwords or 2FA codes = 5 minutes on this device (Supabase adds its own server rate limits).
- Lost phone AND recovery codes: an administrator deletes the user in Supabase (Authentication -> Users) and the person registers again.

## Matches the hospital prototype
Sign-in lockout (5 wrong tries = 5 min), specialty on sign-up, age required (0-120), delete only waiting/in-care patients,
queue shows specialty + "Not yet diagnosed", removed/reassigned/room-available notifications, summary for the current 8-hour shift.

## Restore the original demo accounts (Supabase)

The original prototype demo accounts are restored through Supabase Auth and the `profiles` table (not browser LocalStorage). The setup script creates or updates these four test accounts:

- `REC-1001` — Angela Mae Santos (Receptionist)
- `RN-3001` — Maria Panitan, RN (Nurse)
- `DR-2001` — Dr. Alexander Reyes, MD (Doctor)
- `RN-3005` — Maria Clara Dela Cruz (Nurse)

All four use the original test password `demo1234`. On first sign-in, each account must complete the app's authenticator-based two-factor setup if it does not already have a verified authenticator.

1. In Supabase Dashboard, open **Project Settings → API** and copy the **service_role** secret key. Keep it private.
2. In the project root, copy `.env.example` to `.env`.
3. Put your Supabase project URL, service-role key, and the same hospital code stored in `app_secrets` into `.env`.
4. Run `npm install`, then `npm run demo:accounts`.

The script runs locally and uses the service-role key only from `.env`; it does not add that key to the website. Never put the service-role key in `www/`, commit `.env`, or share it. These are development-only accounts with a shared, intentionally weak password. Do not use them for real staff or patient data.

SUPABASE DATABASE UPDATE (IMPORTANT)
------------------------------------
After applying backend/schema.sql and backend/schema-stage2.sql, also run
the complete backend/schema-stage3.sql file in Supabase Dashboard > SQL Editor.
Stage 3 provides the RPC functions used by the Doctor and Nurse screens:
- set_patient_diagnosis: saves a doctor's diagnosis for their assigned patient
- set_patient_status: Mark as seen, Admit, and Discharge
- complete_task: Nurse re-check/task Done action

After the SQL succeeds, run this in a new SQL Editor query:
NOTIFY pgrst, 'reload schema';

Then refresh/reopen the app. Do not run stage 3 before schema.sql and schema-stage2.sql.


TriageFlow Stage 4 database update
----------------------------------
After schema.sql, schema-stage2.sql and schema-stage3.sql have been run in the Supabase SQL Editor, run backend/schema-stage4.sql once. Stage 4 adds event notifications, atomic reassignment, patient/task history, duplicate-event protection, and the IT-managed profiles.is_active flag. The migration reloads the PostgREST schema cache at the end. Refresh/reopen the app after the SQL succeeds. Hospital IT must set profiles.is_active=false AND disable the matching Supabase Auth user to deactivate an account.
