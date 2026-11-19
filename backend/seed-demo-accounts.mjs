import { readFile } from 'node:fs/promises';

const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hospitalCode = process.env.HOSPITAL_CODE || '12345678';
const password = 'Demo1234';

if (!baseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.');
  process.exit(1);
}

const accounts = [
  { staff_id: 'REC-1001', full_name: 'Angela Mae Santos', role: 'Receptionist', specialty: null, status: 'available' },
  { staff_id: 'RN-3001', full_name: 'Maria Panitan, RN', role: 'Nurse', specialty: 'Registered Nurse', status: 'available' },
  { staff_id: 'DR-2001', full_name: 'Dr. Alexander Reyes, MD', role: 'Doctor', specialty: 'Emergency Medicine Physician', status: 'available' },
  { staff_id: 'RN-3005', full_name: 'Maria Clara Dela Cruz', role: 'Nurse', specialty: 'Registered Nurse (RN)', status: 'busy' },
];

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.msg || body.message || body.error_description || body.error || response.statusText;
    throw new Error(`${response.status}: ${message}`);
  }
  return body;
}

async function getUsers() {
  const users = [];
  for (let page = 1; page <= 10; page++) {
    const result = await request(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    const batch = result.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

try {
  const users = await getUsers();
  for (const account of accounts) {
    const email = `${account.staff_id.toLowerCase()}@triageflow.app`;
    const metadata = {
      staff_id: account.staff_id,
      full_name: account.full_name,
      role: account.role,
      specialty: account.specialty || '',
      phone: '',
    };
    let user = users.find((item) => item.email?.toLowerCase() === email);

    if (user) {
      user = await request(`/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ password, email_confirm: true, user_metadata: metadata }),
      });
      console.log(`Updated Auth account: ${account.staff_id}`);
    } else {
      user = await request('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { ...metadata, hospital_code: hospitalCode } }),
      });
      console.log(`Created Auth account: ${account.staff_id}`);
    }

    const userId = user.id || user.user?.id;
    if (!userId) throw new Error(`Supabase did not return a user ID for ${account.staff_id}.`);

    await request('/rest/v1/profiles?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: userId,
        staff_id: account.staff_id,
        full_name: account.full_name,
        role: account.role,
        specialty: account.specialty,
        status: account.status,
      }),
    });
    console.log(`Verified profile: ${account.staff_id} (${account.role})`);
  }

  console.log('\nDemo accounts are ready. Password for all four: Demo1234');
  console.log('Each account will be asked to set up its authenticator (2FA) on first sign-in if one is not already linked.');
} catch (error) {
  console.error('\nDemo account setup failed:', error.message);
  process.exit(1);
}
