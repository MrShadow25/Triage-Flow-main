/* accounts-import.js — accounts from the old PHP/MySQL version.
 *
 * In phpMyAdmin (database hospital_queue_db) run:
 *   SELECT staff_id, full_name, role, specialty, mobile FROM users WHERE password_hash IS NOT NULL;
 * Click Export -> JSON, then paste the rows between the brackets below. Example row:
 *   { "staff_id": "DR-2010", "full_name": "Dr. Jane Cruz, MD", "role": "doc", "specialty": "Cardiologist", "mobile": "09171234567" },
 * (role is rec / nurse / doc). Each person then taps "Forgot password?" once to set a new password.
 */
window.TF_IMPORT = [
  { staff_id: 'DR-2001',  full_name: 'Dr. Alexander Reyes, MD',  role: 'doc',   specialty: 'Emergency Medicine Physician', mobile: '09089195113', status: 'available' },
  { staff_id: 'RN-3001',  full_name: 'Maria Panitan, RN',        role: 'nurse', specialty: 'Registered Nurse',             mobile: '09089195113', status: 'available' },
  { staff_id: 'REC-1001', full_name: 'Angela Mae Santos',        role: 'rec',   specialty: null,                           mobile: '09089195113' },
  { staff_id: 'RN-3005',  full_name: 'Maria Clara Dela Cruz',    role: 'nurse', specialty: 'Registered Nurse (RN)',        mobile: '09089195113', status: 'busy' },
];
