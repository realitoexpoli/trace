-- Tracé: user profiles.
-- Run after 001_init.sql: Dashboard → SQL Editor → paste this file → Run. Safe to run again.
--
-- People fill in a short profile (name, what they do, subject, school) when they sign up.
-- Their projects are saved online only once the profile is complete: the database refuses
-- cloud decks for an unfinished profile, whatever the web page does.

-------------------------------------------------------------------------------
-- Profile fields
-------------------------------------------------------------------------------
alter table public.profiles add column if not exists display_name         text;
alter table public.profiles add column if not exists role                 text;
alter table public.profiles add column if not exists subject              text;
alter table public.profiles add column if not exists organization         text;
alter table public.profiles add column if not exists avatar_color         text;
alter table public.profiles add column if not exists profile_completed_at timestamptz;

do $$ begin
  alter table public.profiles add constraint profiles_display_name_len check (display_name is null or char_length(display_name) between 1 and 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_role_known check (role is null or role in ('teacher', 'lecturer', 'student', 'creator', 'other'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_subject_len check (subject is null or char_length(subject) <= 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_org_len check (organization is null or char_length(organization) <= 120);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_avatar_color check (avatar_color is null or avatar_color ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;

-- A profile is complete when it has a name and a role.
create or replace function public.profile_complete(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select display_name is not null and btrim(display_name) <> '' and role is not null
                     from profiles where id = p_user), false);
$$;

-- People may edit these fields of their own profile, and nothing else (not their plan).
drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant update (display_name, role, subject, organization, avatar_color) on public.profiles to authenticated;

-- Tidy the text and note when the profile was first completed.
create or replace function public.tidy_profile()
returns trigger language plpgsql as $$
begin
  new.display_name := nullif(btrim(new.display_name), '');
  new.subject      := nullif(btrim(new.subject), '');
  new.organization := nullif(btrim(new.organization), '');
  if new.profile_completed_at is null and new.display_name is not null and new.role is not null then
    new.profile_completed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists profiles_tidy on public.profiles;
create trigger profiles_tidy before insert or update on public.profiles
  for each row execute function public.tidy_profile();

-------------------------------------------------------------------------------
-- Cloud decks need a finished profile (added to the plan-limit check from 001)
-------------------------------------------------------------------------------
create or replace function public.enforce_deck_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan  text;
  v_max   int;
  v_bytes int;
  v_count int;
begin
  if not profile_complete(new.owner) then
    raise exception 'profile_required' using hint = 'Finish your profile to save projects online.';
  end if;

  select coalesce((select plan from profiles where id = new.owner), 'free') into v_plan;
  select max_decks, max_deck_bytes into v_max, v_bytes from plan_limits(v_plan);

  if octet_length(new.data::text) > v_bytes then
    raise exception 'deck_too_large' using hint = format('Decks can be up to %s MB on your plan.', v_bytes / 1000000);
  end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext(new.owner::text));
    select count(*) into v_count from decks where owner = new.owner;
    if v_count >= v_max then
      raise exception 'free_limit' using hint = format('The free plan keeps %s decks in the cloud.', v_max);
    end if;
  else
    new.updated_at := now();
  end if;
  return new;
end $$;

-------------------------------------------------------------------------------
-- Shared decks show who made them
-------------------------------------------------------------------------------
drop function if exists public.get_shared_deck(text);
create function public.get_shared_deck(p_slug text)
returns table (name text, data jsonb, owner_plan text, updated_at timestamptz, owner_name text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    update decks d set view_count = d.view_count + 1
      from profiles p
     where d.share_slug = p_slug and d.share_mode = 'link' and p.id = d.owner
    returning d.name, d.data, p.plan, d.updated_at, p.display_name;
end $$;
revoke all on function public.get_shared_deck(text) from public;
grant execute on function public.get_shared_deck(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- Deleting your own account (and all its decks)
-------------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_status text; v_plan text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select plan, subscription_status into v_plan, v_status from public.profiles where id = auth.uid();
  -- a running subscription would keep charging: it has to be cancelled first
  if v_plan = 'pro' and v_status in ('active', 'trialing', 'past_due') then
    raise exception 'cancel_subscription_first' using hint = 'Cancel Pro in Manage billing, then delete the account.';
  end if;
  delete from auth.users where id = auth.uid();   -- profile and decks go with it (on delete cascade)
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
