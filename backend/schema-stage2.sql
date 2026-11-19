-- TriageFlow backend, stage 2: run this ONCE in Supabase -> SQL Editor (after schema.sql).
-- Adds: recovery codes, server-side lockouts, password reset with a recovery code.

create extension if not exists pgcrypto with schema extensions;

create table if not exists recovery_codes (
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  primary key (user_id, code_hash)
);
alter table recovery_codes enable row level security;     -- no policies: only the functions below can touch it

create table if not exists auth_attempts (key text primary key, fails int not null default 0, locked_until timestamptz);
alter table auth_attempts enable row level security;

-- ---------- internal helpers (not callable from the app) ----------
create or replace function _hash_code(c text) returns text language sql immutable as
$$ select encode(sha256(convert_to(upper(regexp_replace(coalesce(c,''), '[^A-Za-z0-9]', '', 'g')), 'utf8')), 'hex') $$;

create or replace function _locked(k text) returns boolean language sql security definer set search_path = public as
$$ select coalesce((select locked_until > now() from auth_attempts where key = k), false) $$;

create or replace function _fail(k text) returns void language plpgsql security definer set search_path = public as $$
declare f int;
begin
  insert into auth_attempts(key) values (k) on conflict do nothing;
  update auth_attempts set fails = case when locked_until is not null and locked_until <= now() then 0 else fails end,
                           locked_until = case when locked_until <= now() then null else locked_until end where key = k;
  update auth_attempts set fails = fails + 1 where key = k returning fails into f;
  if f >= 5 then update auth_attempts set locked_until = now() + interval '5 minutes', fails = 0 where key = k; end if;
end $$;

create or replace function _ok(k text) returns void language sql security definer set search_path = public as
$$ delete from auth_attempts where key = k $$;

create or replace function _pw_problem(pw text, sid text) returns text language plpgsql immutable as $$
begin
  if pw is null or length(pw) < 8 then return 'Password must be at least 8 characters.'; end if;
  if pw !~ '[a-z]' or pw !~ '[A-Z]' or pw !~ '[0-9]' then return 'Password needs a lowercase letter, an uppercase letter and a number.'; end if;
  if sid <> '' and position(lower(sid) in lower(pw)) > 0 then return 'Password must not contain your Staff ID.'; end if;
  return null;
end $$;

revoke all on function _hash_code(text), _locked(text), _fail(text), _ok(text), _pw_problem(text, text) from public, anon, authenticated;

-- ---------- recovery codes ----------
create or replace function save_recovery_codes(codes text[]) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_mfa() then raise exception 'Not signed in'; end if;
  if coalesce(array_length(codes, 1), 0) not between 6 and 12 then raise exception 'Bad code list'; end if;
  delete from recovery_codes where user_id = auth.uid();
  insert into recovery_codes(user_id, code_hash) select auth.uid(), _hash_code(c) from unnest(codes) c on conflict do nothing;
end $$;

-- Lost phone: signed in with the password but cannot give a 2FA code. A valid one-time recovery code
-- removes the old authenticator so a new one can be linked.
create or replace function use_recovery_code(p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); k text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  k := 'rc:' || uid;
  if _locked(k) then return jsonb_build_object('ok', false, 'error', 'Too many attempts. Try again in 5 minutes.'); end if;
  update recovery_codes set used_at = now() where user_id = uid and code_hash = _hash_code(p_code) and used_at is null;
  if not found then perform _fail(k); return jsonb_build_object('ok', false, 'error', 'That recovery code is not valid.'); end if;
  delete from auth.mfa_factors where user_id = uid;
  perform _ok(k);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- forgot password (no email needed): Staff ID + hospital code + one-time recovery code ----------
create or replace function reset_password_with_recovery(p_staff_id text, p_hospital_code text, p_recovery_code text, p_new_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid; sid text := upper(trim(coalesce(p_staff_id, ''))); k text := 'rs:' || upper(trim(coalesce(p_staff_id, '')));
        prob text; secret text; h text := _hash_code(p_recovery_code);
begin
  prob := _pw_problem(p_new_password, sid);
  if prob is not null then return jsonb_build_object('ok', false, 'error', prob); end if;
  if _locked(k) then return jsonb_build_object('ok', false, 'error', 'Too many attempts. Try again in 5 minutes.'); end if;
  select id into uid from profiles where staff_id = sid;
  select value into secret from app_secrets where key = 'hospital_code';
  if uid is null or p_hospital_code is distinct from secret
     or not exists (select 1 from recovery_codes where user_id = uid and code_hash = h and used_at is null) then
    perform _fail(k);
    return jsonb_build_object('ok', false, 'error', 'The details are incorrect.');   -- same message for every failure
  end if;
  if exists (select 1 from auth.users where id = uid and encrypted_password = extensions.crypt(p_new_password, encrypted_password)) then
    return jsonb_build_object('ok', false, 'error', 'Choose a password you are not already using.');
  end if;
  update recovery_codes set used_at = now() where user_id = uid and code_hash = h;
  update auth.users set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now() where id = uid;
  delete from auth.sessions where user_id = uid;                                   -- sign out everywhere
  insert into notifications(role, to_sid, title, detail, hot)
    select role, staff_id, 'Password changed', 'Your password was changed with a recovery code. If this was not you, tell your administrator.', true
    from profiles where id = uid;
  perform _ok(k);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function save_recovery_codes(text[]), use_recovery_code(text), reset_password_with_recovery(text, text, text, text) from public, anon, authenticated;
grant execute on function save_recovery_codes(text[]), use_recovery_code(text) to authenticated;
grant execute on function reset_password_with_recovery(text, text, text, text) to anon, authenticated;

-- ---------- sign-up trigger: same as before, but the hospital code is wiped from the stored profile data ----------
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare code text; sid text; r text; pre text;
begin
  select value into code from app_secrets where key = 'hospital_code';
  if coalesce(new.raw_user_meta_data->>'hospital_code','') is distinct from code then raise exception 'Invalid hospital code'; end if;
  sid := upper(trim(coalesce(new.raw_user_meta_data->>'staff_id','')));
  r := new.raw_user_meta_data->>'role';
  pre := case r when 'Receptionist' then 'REC' when 'Nurse' then 'RN' when 'Doctor' then 'DR' end;
  if pre is null or sid !~ ('^' || pre || '-[0-9]{3,6}$') then raise exception 'Invalid Staff ID for role'; end if;
  insert into profiles (id, staff_id, full_name, role, specialty, phone)
  values (new.id, sid, left(trim(new.raw_user_meta_data->>'full_name'),100), r,
          left(nullif(trim(coalesce(new.raw_user_meta_data->>'specialty','')),''),100),
          nullif(new.raw_user_meta_data->>'phone',''));
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'hospital_code' where id = new.id;
  return new;
end $$;
