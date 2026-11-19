-- TriageFlow, stage 4: run ONCE in Supabase SQL Editor after schema.sql, schema-stage2.sql and schema-stage3.sql.
-- Adds synchronized workflow notifications, reassignment, preserved task/patient history,
-- duplicate-event protection, and an IT-managed active flag for staff accounts.

-- ---------- staff activation ----------
alter table profiles add column if not exists is_active boolean not null default true;

create or replace function lock_profile_fields() returns trigger language plpgsql as $$
begin
  if new.role <> old.role or new.staff_id <> old.staff_id or new.id <> old.id
     or (new.is_active <> old.is_active and auth.uid() is not null) then
    raise exception 'Not allowed';
  end if;
  return new;
end $$;

-- ---------- event keys and history ----------
alter table notifications add column if not exists event_key text;
create unique index if not exists notifications_event_key_uq
  on notifications(event_key) where event_key is not null;

create table if not exists patient_history (
  id bigint generated always as identity primary key,
  patient_id bigint not null references patients(id) on delete cascade,
  event_type text not null,
  detail text not null,
  actor_sid text,
  actor_role text,
  event_key text unique,
  created_at timestamptz not null default now()
);

create table if not exists task_history (
  task_id bigint primary key,
  patient_id bigint not null references patients(id) on delete cascade,
  nurse_sid text,
  title text not null,
  due timestamptz not null,
  completed_at timestamptz not null default now(),
  completed_by text,
  completed_by_role text,
  event_key text unique
);

alter table patient_history enable row level security;
alter table task_history enable row level security;
drop policy if exists patient_history_read on patient_history;
create policy patient_history_read on patient_history for select using (
  is_mfa() and (
    my_role() = 'Receptionist' or
    exists (select 1 from patients p where p.id = patient_history.patient_id and (p.doc_sid = my_sid() or p.nu_sid = my_sid()))
  )
);
drop policy if exists task_history_read on task_history;
create policy task_history_read on task_history for select using (
  is_mfa() and (my_role() = 'Receptionist' or nurse_sid = my_sid())
);

-- Internal helper: all workflow notifications use a unique event key so a retried
-- database action cannot create duplicate notifications.
create or replace function _tf_notify(
  p_role text, p_to_sid text, p_title text, p_detail text, p_hot boolean, p_event_key text
) returns void language sql security definer set search_path = public as $$
  insert into notifications(role, to_sid, title, detail, hot, event_key)
  values (p_role, p_to_sid, p_title, p_detail, coalesce(p_hot, false), p_event_key)
  on conflict (event_key) where event_key is not null do nothing
$$;

create or replace function _tf_patient_event(
  p_patient_id bigint, p_type text, p_detail text, p_event_key text
) returns void language sql security definer set search_path = public as $$
  insert into patient_history(patient_id, event_type, detail, actor_sid, actor_role, event_key)
  values (p_patient_id, p_type, p_detail, my_sid(), my_role(), p_event_key)
  on conflict (event_key) do nothing
$$;

revoke all on function _tf_notify(text,text,text,text,boolean,text), _tf_patient_event(bigint,text,text,text) from public, anon, authenticated;

-- ---------- reassignment: one atomic server-side operation ----------
drop function if exists reassign_patient(bigint, text, text, text);
create or replace function reassign_patient(p_id bigint, p_doc_sid text, p_nu_sid text, p_event_key text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p patients%rowtype;
  old_doc text;
  old_nu text;
  doc_name text;
  nurse_name text;
  mins int;
begin
  if not is_mfa() or my_role() <> 'Receptionist' then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_event_key, '')), '') is null then raise exception 'Missing event key'; end if;
  select * into p from patients where id = p_id for update;
  if not found or p.st = 'out' then raise exception 'Patient is no longer active'; end if;

  select staff_id into old_doc from profiles where staff_id = p_doc_sid and role = 'Doctor' and is_active = true
    and (staff_id = p.doc_sid or status = 'available');
  if old_doc is null then raise exception 'Choose an available Doctor'; end if;
  select staff_id into old_nu from profiles where staff_id = p_nu_sid and role = 'Nurse' and is_active = true
    and (staff_id = p.nu_sid or status = 'available');
  if old_nu is null then raise exception 'Choose an available Nurse'; end if;

  old_doc := p.doc_sid;
  old_nu := p.nu_sid;
  select full_name into doc_name from profiles where staff_id = p_doc_sid;
  select full_name into nurse_name from profiles where staff_id = p_nu_sid;

  if old_doc is distinct from p_doc_sid or old_nu is distinct from p_nu_sid then
    update patients set doc_sid = p_doc_sid, nu_sid = p_nu_sid where id = p_id;

    if old_doc is distinct from p_doc_sid then
      if old_doc is not null then
        perform _tf_notify('Doctor', old_doc, 'Patient Reassigned', p.name || ' was reassigned to ' || doc_name || '.', false, p_event_key || ':old-doctor');
      end if;
      perform _tf_notify('Doctor', p_doc_sid, 'New Patient Assigned', 'Patient ' || p.name || ' — Complaint: ' || p.complaint, p.priority = 1, p_event_key || ':new-doctor');
    end if;

    if old_nu is distinct from p_nu_sid then
      update tasks set nurse_sid = p_nu_sid where patient_id = p_id;
      if not exists (select 1 from tasks where patient_id = p_id) then
        mins := (array[15,30,60,120,240])[p.priority];
        insert into tasks(patient_id, nurse_sid, due) values (p_id, p_nu_sid, now() + make_interval(mins => mins));
      end if;
      if old_nu is not null then
        perform _tf_notify('Nurse', old_nu, 'Patient Reassigned', p.name || ' was reassigned to ' || nurse_name || '.', false, p_event_key || ':old-nurse');
      end if;
      perform _tf_notify('Nurse', p_nu_sid, 'New Patient Assigned', 'Patient ' || p.name || ' — Complaint: ' || p.complaint, p.priority = 1, p_event_key || ':new-nurse');
    end if;

    perform _tf_patient_event(p_id, 'reassigned', 'Doctor: ' || coalesce(doc_name, 'Unassigned') || '; Nurse: ' || coalesce(nurse_name, 'Unassigned'), p_event_key || ':history');
  end if;
end $$;

-- ---------- diagnosis: Doctor only; Receptionist receives an event ----------
drop function if exists set_patient_diagnosis(bigint, text);
drop function if exists set_patient_diagnosis(bigint, text, text);
create function set_patient_diagnosis(p_id bigint, p_dx text, p_event_key text) returns void
language plpgsql security definer set search_path = public as $$
declare p patients%rowtype; clean_dx text;
begin
  if not is_mfa() then raise exception 'Not signed in'; end if;
  select * into p from patients where id = p_id for update;
  if not found then raise exception 'Patient not found'; end if;
  if not (my_role() = 'Doctor' and p.doc_sid = my_sid()) then raise exception 'Not allowed'; end if;
  clean_dx := left(trim(coalesce(p_dx, '')), 255);
  if clean_dx = '' then raise exception 'Enter a diagnosis'; end if;
  if clean_dx is distinct from p.dx then
    update patients set dx = clean_dx where id = p_id;
    perform _tf_patient_event(p_id, 'diagnosis', 'Diagnosis entered: ' || clean_dx, p_event_key || ':history');
    perform _tf_notify('Receptionist', null, 'Diagnosis Updated', 'Dr. ' || coalesce((select full_name from profiles where staff_id = my_sid()), my_sid()) || ' entered a diagnosis for ' || p.name || ': ' || clean_dx, false, p_event_key || ':receptionist');
  end if;
end $$;

-- ---------- patient status: Doctor or Receptionist; everyone sees the database update ----------
drop function if exists set_patient_status(bigint, text);
drop function if exists set_patient_status(bigint, text, text);
create function set_patient_status(p_id bigint, p_st text, p_event_key text) returns void
language plpgsql security definer set search_path = public as $$
declare p patients%rowtype; status_detail text; room_text text;
begin
  if not is_mfa() then raise exception 'Not signed in'; end if;
  select * into p from patients where id = p_id for update;
  if not found then raise exception 'Patient not found'; end if;
  if not (my_role() = 'Receptionist' or (my_role() = 'Doctor' and p.doc_sid = my_sid())) then raise exception 'Not allowed'; end if;

  if p_st = 'seen' then
    update patients set t_seen = coalesce(t_seen, now()), st = case when st = 'waiting' then 'in_care' else st end where id = p_id;
    status_detail := 'was marked as seen';
  elsif p_st = 'admitted' then
    update patients set t_seen = coalesce(t_seen, now()), t_adm = coalesce(t_adm, now()), st = 'admitted' where id = p_id;
    status_detail := 'was admitted';
  elsif p_st = 'out' then
    update patients set t_seen = coalesce(t_seen, now()), t_closed = now(), st = 'out', room = null where id = p_id;
    delete from tasks where patient_id = p_id;
    status_detail := 'was discharged';
    if p.room is not null then
      room_text := 'Room ' || lpad(p.room::text, 2, '0') || ' is available';
      perform _tf_notify('Receptionist', null, 'Room Availability', room_text, false, p_event_key || ':room');
    end if;
    perform auto_assign();
  else
    raise exception 'Bad status';
  end if;

  if (p_st = 'seen' and p.t_seen is null) or p.st is distinct from p_st then
    perform _tf_patient_event(p_id, 'status', p.name || ' ' || status_detail, p_event_key || ':history');
    perform _tf_notify('Receptionist', null, 'Patient Status Updated', 'Patient ' || p.name || ' ' || status_detail || '.', false, p_event_key || ':receptionist');
  end if;
end $$;

-- ---------- completed re-checks are archived before the active task is removed ----------
drop function if exists complete_task(bigint);
drop function if exists complete_task(bigint, text);
create function complete_task(p_id bigint, p_event_key text) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks%rowtype; p patients%rowtype; inserted_count int;
begin
  if not is_mfa() then raise exception 'Not signed in'; end if;
  select * into t from tasks where id = p_id for update;
  if not found then return; end if;
  if not (my_role() = 'Receptionist' or (my_role() = 'Nurse' and t.nurse_sid = my_sid())) then raise exception 'Not allowed'; end if;

  insert into task_history(task_id, patient_id, nurse_sid, title, due, completed_at, completed_by, completed_by_role, event_key)
  values (t.id, t.patient_id, t.nurse_sid, t.title, t.due, now(), my_sid(), my_role(), p_event_key)
  on conflict (task_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return; end if;

  delete from tasks where id = p_id;
  select * into p from patients where id = t.patient_id;
  if found then
    perform _tf_notify('Receptionist', null, 'Nurse Task Completed', 'Re-check for ' || p.name || ' was completed by ' || coalesce((select full_name from profiles where staff_id = t.nurse_sid), t.nurse_sid) || '.', false, p_event_key || ':receptionist');
    if p.st <> 'out' and p.nu_sid is not null then
      insert into tasks(patient_id, nurse_sid, due) values (p.id, p.nu_sid, now() + make_interval(mins => (array[15,30,60,120,240])[p.priority]));
    end if;
  end if;
end $$;

-- ---------- automatic assignment excludes staff deactivated by hospital IT ----------
create or replace function auto_assign() returns void language plpgsql security definer set search_path = public as $$
declare p patients%rowtype; d text; n text; r int; mins int;
begin
  if not is_mfa() then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(42);
  for p in select * from patients where st in ('waiting','in_care') and (doc_sid is null or nu_sid is null or room is null)
           order by priority, t0 loop
    if p.doc_sid is null then
      select pr.staff_id into d from profiles pr where pr.role='Doctor' and pr.is_active = true and pr.status='available'
        and (select count(*) from patients x where x.st <> 'out' and x.doc_sid = pr.staff_id) < 3
        order by (select count(*) from patients x where x.st <> 'out' and x.doc_sid = pr.staff_id) limit 1;
      if d is not null then
        update patients set doc_sid = d where id = p.id;
        insert into notifications(role,to_sid,title,detail,hot,event_key) values ('Doctor', d, 'New Patient Assigned', 'Patient '||p.name||' - Complaint: '||p.complaint, p.priority = 1, gen_random_uuid()::text);
      end if;
    end if;
    if p.nu_sid is null then
      select pr.staff_id into n from profiles pr where pr.role='Nurse' and pr.is_active = true and pr.status='available'
        and (select count(*) from patients x where x.st <> 'out' and x.nu_sid = pr.staff_id) < 2
        order by (select count(*) from patients x where x.st <> 'out' and x.nu_sid = pr.staff_id) limit 1;
      if n is not null then
        update patients set nu_sid = n where id = p.id;
        mins := (array[15,30,60,120,240])[p.priority];
        insert into tasks(patient_id,nurse_sid,due) values (p.id, n, now() + make_interval(mins => mins));
        insert into notifications(role,to_sid,title,detail,hot,event_key) values ('Nurse', n, 'New Patient Assigned', 'Patient '||p.name||' - Complaint: '||p.complaint, p.priority = 1, gen_random_uuid()::text);
      end if;
    end if;
    if p.room is null and p.priority <= 3 then
      select g into r from generate_series(1,6) g
        where not exists (select 1 from patients x where x.st <> 'out' and x.room = g) order by g limit 1;
      if r is not null then
        update patients set room = r where id = p.id;
        insert into notifications(role,title,detail,event_key) values ('Receptionist','Patient Queue Update','Patient '||p.name||' was moved to Room '||lpad(r::text,2,'0'), gen_random_uuid()::text);
      end if;
    end if;
  end loop;
end $$;

revoke all on function reassign_patient(bigint,text,text,text), set_patient_diagnosis(bigint,text,text),
  set_patient_status(bigint,text,text), complete_task(bigint,text) from public, anon;
grant execute on function reassign_patient(bigint,text,text,text), set_patient_diagnosis(bigint,text,text),
  set_patient_status(bigint,text,text), complete_task(bigint,text) to authenticated;
revoke all on function auto_assign() from public, anon;
grant execute on function auto_assign() to authenticated;

-- The hospital's IT personnel deactivate accounts outside the app by setting profiles.is_active=false
-- and disabling the corresponding Auth user. The app never grants this permission to staff users.

-- Refresh the PostgREST function schema cache after the new RPC signatures are installed.
NOTIFY pgrst, 'reload schema';
