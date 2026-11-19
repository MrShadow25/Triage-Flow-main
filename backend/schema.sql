-- TriageFlow backend, stage 1: run this whole file once in Supabase -> SQL Editor.
-- Before running: Authentication -> Providers -> Email: turn OFF "Confirm email".
-- Authentication -> MFA: make sure TOTP is enabled.

create table if not exists app_secrets (key text primary key, value text not null);
alter table app_secrets enable row level security;           -- no policies = nobody can read it from the app
insert into app_secrets values ('hospital_code', '12345678') on conflict (key) do nothing;  -- change it here

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  staff_id text unique not null,
  full_name text not null,
  role text not null check (role in ('Receptionist','Nurse','Doctor')),
  specialty text,
  phone text,
  status text not null default 'available' check (status in ('available','busy','off'))
);

create table if not exists patients (
  id bigint generated always as identity primary key,
  name text not null,
  age int not null check (age between 0 and 120),
  priority int not null check (priority between 1 and 5),
  complaint text not null,
  dx text not null default '',
  symptoms text[] not null default '{}',
  room int check (room between 1 and 6),
  doc_sid text references profiles(staff_id) on update cascade on delete set null,
  nu_sid  text references profiles(staff_id) on update cascade on delete set null,
  st text not null default 'waiting' check (st in ('waiting','in_care','admitted','out')),
  t0 timestamptz not null default now(),
  t_seen timestamptz, t_adm timestamptz, t_closed timestamptz
);

create table if not exists tasks (
  id bigint generated always as identity primary key,
  patient_id bigint not null references patients(id) on delete cascade,
  nurse_sid text not null references profiles(staff_id) on update cascade on delete cascade,
  title text not null default 'Re-check',
  due timestamptz not null
);

create table if not exists notifications (
  id bigint generated always as identity primary key,
  role text not null check (role in ('Receptionist','Nurse','Doctor')),
  to_sid text,                                   -- null = everyone with that role
  title text not null, detail text, hot boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- helpers ----------
-- True only after the user has passed 2FA (JWT assurance level aal2).
create or replace function is_mfa() returns boolean language sql stable as
$$ select auth.uid() is not null and coalesce(auth.jwt()->>'aal','') = 'aal2' $$;
create or replace function my_role() returns text language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;
create or replace function my_sid() returns text language sql stable security definer set search_path = public as
$$ select staff_id from profiles where id = auth.uid() $$;

-- ---------- sign-up: hospital code + Staff ID format are checked by the SERVER ----------
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
          new.raw_user_meta_data->>'phone')
  on conflict (staff_id) do update set id = excluded.id, full_name = excluded.full_name;  -- claims a pre-seeded directory row
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- people may change only their own status, never role / staff_id
create or replace function lock_profile_fields() returns trigger language plpgsql as $$
begin
  if new.role <> old.role or new.staff_id <> old.staff_id or new.id <> old.id then raise exception 'Not allowed'; end if;
  return new;
end $$;
drop trigger if exists profiles_lock on profiles;
create trigger profiles_lock before update on profiles for each row execute function lock_profile_fields();

-- ---------- row-level security (all of it requires 2FA) ----------
alter table profiles enable row level security;
alter table patients enable row level security;
alter table tasks enable row level security;
alter table notifications enable row level security;

create policy profiles_read on profiles for select using (is_mfa());
create policy profiles_self_update on profiles for update using (is_mfa() and id = auth.uid());

create policy patients_read on patients for select using (
  is_mfa() and (my_role() = 'Receptionist' or doc_sid = my_sid() or nu_sid = my_sid()));
create policy patients_insert on patients for insert with check (is_mfa() and my_role() = 'Receptionist');
create policy patients_delete on patients for delete using (is_mfa() and my_role() = 'Receptionist' and st in ('waiting','in_care'));
create policy patients_update on patients for update using (
  is_mfa() and (my_role() = 'Receptionist' or doc_sid = my_sid()));   -- doctors: diagnosis + seen/admit/discharge

create policy tasks_read on tasks for select using (is_mfa() and (my_role() = 'Receptionist' or nurse_sid = my_sid()));
create policy tasks_write on tasks for all using (is_mfa() and (my_role() = 'Receptionist' or nurse_sid = my_sid()))
  with check (is_mfa() and (my_role() = 'Receptionist' or nurse_sid = my_sid()));

create policy notif_read on notifications for select using (
  is_mfa() and role = my_role() and (to_sid is null or to_sid = my_sid()));
create policy notif_insert on notifications for insert with check (is_mfa());

-- ---------- auto-assign (runs on the server, so two phones can't double-assign) ----------
create or replace function auto_assign() returns void language plpgsql security definer set search_path = public as $$
declare p patients%rowtype; d text; n text; r int; mins int;
begin
  if not is_mfa() then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(42);
  for p in select * from patients where st in ('waiting','in_care') and (doc_sid is null or nu_sid is null or room is null)
           order by priority, t0 loop
    if p.doc_sid is null then
      select pr.staff_id into d from profiles pr where pr.role='Doctor' and pr.status='available'
        and (select count(*) from patients x where x.st <> 'out' and x.doc_sid = pr.staff_id) < 3
        order by (select count(*) from patients x where x.st <> 'out' and x.doc_sid = pr.staff_id) limit 1;
      if d is not null then
        update patients set doc_sid = d where id = p.id;
        insert into notifications(role,to_sid,title,detail,hot) values ('Doctor', d, 'New Patient Assigned', 'Patient '||p.name||' - Complaint: '||p.complaint, p.priority = 1);
      end if;
    end if;
    if p.nu_sid is null then
      select pr.staff_id into n from profiles pr where pr.role='Nurse' and pr.status='available'
        and (select count(*) from patients x where x.st <> 'out' and x.nu_sid = pr.staff_id) < 2
        order by (select count(*) from patients x where x.st <> 'out' and x.nu_sid = pr.staff_id) limit 1;
      if n is not null then
        update patients set nu_sid = n where id = p.id;
        mins := (array[15,30,60,120,240])[p.priority];
        insert into tasks(patient_id,nurse_sid,due) values (p.id, n, now() + make_interval(mins => mins));
        insert into notifications(role,to_sid,title,detail,hot) values ('Nurse', n, 'New Patient Assigned', 'Patient '||p.name||' - Complaint: '||p.complaint, p.priority = 1);
      end if;
    end if;
    if p.room is null and p.priority <= 3 then
      select g into r from generate_series(1,6) g
        where not exists (select 1 from patients x where x.st <> 'out' and x.room = g) order by g limit 1;
      if r is not null then
        update patients set room = r where id = p.id;
        insert into notifications(role,title,detail) values ('Receptionist','Patient Queue Update','Patient '||p.name||' was moved to Room '||lpad(r::text,2,'0'));
      end if;
    end if;
  end loop;
end $$;
revoke all on function auto_assign() from public, anon;
grant execute on function auto_assign() to authenticated;

-- ---------- live updates ----------
alter publication supabase_realtime add table patients, tasks, notifications, profiles;

-- ---------- staff directory (rows are claimed when that person signs up with the same Staff ID) ----------
-- The profile's id must reference auth.users, so the directory is created at sign-up instead.
-- Stage 2 (next): client sign-in + Supabase 2FA, recovery codes, stronger forgot-password.
