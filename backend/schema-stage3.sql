-- TriageFlow backend, stage 3: run ONCE in Supabase -> SQL Editor (after schema.sql and schema-stage2.sql).
-- Adds: one-patient-per-room guarantee, and server-side discharge / admit / re-check-done actions.

-- A room can hold only one active patient, even if two phones try at the same moment.
create unique index if not exists patients_one_per_room on patients(room) where room is not null and st <> 'out';

-- Doctor (their own patient): save the clinical diagnosis after assessment.
create or replace function set_patient_diagnosis(p_id bigint, p_dx text) returns void
language plpgsql security definer set search_path = public as $$
declare p patients%rowtype;
begin
  if not is_mfa() then raise exception 'Not signed in'; end if;
  select * into p from patients where id = p_id for update;
  if not found then raise exception 'Patient not found'; end if;
  if not (my_role() = 'Doctor' and p.doc_sid = my_sid()) then
    raise exception 'Not allowed';
  end if;
  if nullif(trim(coalesce(p_dx, '')), '') is null then
    raise exception 'Enter a diagnosis';
  end if;
  update patients set dx = left(trim(p_dx), 255) where id = p_id;
end $$;

-- Doctor (their own patient) or receptionist: seen / admitted / discharged.
create or replace function set_patient_status(p_id bigint, p_st text) returns void language plpgsql security definer set search_path = public as $$
declare p patients%rowtype;
begin
  if not is_mfa() then raise exception 'Not signed in'; end if;
  select * into p from patients where id = p_id for update;
  if not found then raise exception 'Patient not found'; end if;
  if not (my_role() = 'Receptionist' or (my_role() = 'Doctor' and p.doc_sid = my_sid())) then raise exception 'Not allowed'; end if;
  if p_st = 'seen' then
    update patients set t_seen = coalesce(t_seen, now()), st = case when st = 'waiting' then 'in_care' else st end where id = p_id;
  elsif p_st = 'admitted' then
    update patients set t_seen = coalesce(t_seen, now()), t_adm = coalesce(t_adm, now()), st = 'admitted' where id = p_id;
  elsif p_st = 'out' then
    update patients set t_seen = coalesce(t_seen, now()), t_closed = now(), st = 'out', room = null where id = p_id;
    delete from tasks where patient_id = p_id;
    if p.room is not null then
      insert into notifications(role, title, detail) values ('Receptionist', 'Room Availability', 'Room ' || lpad(p.room::text, 2, '0') || ' is available');
    end if;
    perform auto_assign();                                  -- freed doctor / nurse / room goes to the next waiting patient
  else
    raise exception 'Bad status';
  end if;
end $$;

-- Nurse (their own task) or receptionist: mark a re-check done and schedule the next one.
create or replace function complete_task(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
declare t tasks%rowtype; p patients%rowtype;
begin
  if not is_mfa() then raise exception 'Not signed in'; end if;
  select * into t from tasks where id = p_id;
  if not found then return; end if;
  if not (my_role() = 'Receptionist' or t.nurse_sid = my_sid()) then raise exception 'Not allowed'; end if;
  delete from tasks where id = p_id;
  select * into p from patients where id = t.patient_id;
  if found and p.st <> 'out' and p.nu_sid is not null then
    insert into tasks(patient_id, nurse_sid, due) values (p.id, p.nu_sid, now() + make_interval(mins => (array[15,30,60,120,240])[p.priority]));
  end if;
end $$;

revoke all on function set_patient_diagnosis(bigint, text), set_patient_status(bigint, text), complete_task(bigint) from public, anon;
grant execute on function set_patient_diagnosis(bigint, text), set_patient_status(bigint, text), complete_task(bigint) to authenticated;
