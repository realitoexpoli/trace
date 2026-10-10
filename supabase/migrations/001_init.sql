-- Tracé: accounts, cloud decks, share links and plans.
-- Run once in Supabase: Dashboard → SQL Editor → paste this file → Run.
-- Everything a user can do is checked here, in the database, so the rules hold
-- even if someone edits the web page in their browser.

create extension if not exists pgcrypto;

-------------------------------------------------------------------------------
-- Plans. Change the numbers here and they apply everywhere.
-------------------------------------------------------------------------------
create or replace function public.plan_limits(p_plan text)
returns table (max_decks int, max_deck_bytes int)
language sql immutable as $$
  select case when p_plan = 'pro' then 1000000 else 3 end,
         case when p_plan = 'pro' then 20000000 else 2000000 end;
$$;

-------------------------------------------------------------------------------
-- Profiles: one per account. Only the payment webhook (service role) changes the plan.
-------------------------------------------------------------------------------
create table if not exists public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  email                  text,
  plan                   text not null default 'free' check (plan in ('free', 'pro')),
  paddle_customer_id     text unique,
  paddle_subscription_id text,
  subscription_status    text,
  plan_renews_at         timestamptz,
  billing_updated_at     timestamptz,
  created_at             timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- A profile is created for every new account.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-------------------------------------------------------------------------------
-- Decks
-------------------------------------------------------------------------------
create table if not exists public.decks (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default 'Untitled project' check (char_length(name) between 1 and 120),
  data        jsonb not null,
  client_id   text,                       -- the project id in the browser that uploaded it
  share_mode  text not null default 'private' check (share_mode in ('private', 'link')),
  share_slug  text unique,
  view_count  bigint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists decks_owner_idx on public.decks (owner, updated_at desc);

alter table public.decks enable row level security;

drop policy if exists "own decks: read"   on public.decks;
drop policy if exists "own decks: add"    on public.decks;
drop policy if exists "own decks: change" on public.decks;
drop policy if exists "own decks: delete" on public.decks;
create policy "own decks: read"   on public.decks for select to authenticated using (owner = auth.uid());
create policy "own decks: add"    on public.decks for insert to authenticated with check (owner = auth.uid());
create policy "own decks: change" on public.decks for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "own decks: delete" on public.decks for delete to authenticated using (owner = auth.uid());

-- Users may only write their deck's name, content and browser id.
-- Sharing goes through set_deck_sharing(); views are counted by get_shared_deck().
revoke all on public.decks from anon, authenticated;
grant select, delete on public.decks to authenticated;
grant insert (name, data, client_id) on public.decks to authenticated;
grant update (name, data, client_id) on public.decks to authenticated;

-- Plan limits: number of cloud decks and size of each deck.
create or replace function public.enforce_deck_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan  text;
  v_max   int;
  v_bytes int;
  v_count int;
begin
  select coalesce((select plan from profiles where id = new.owner), 'free') into v_plan;
  select max_decks, max_deck_bytes into v_max, v_bytes from plan_limits(v_plan);

  if octet_length(new.data::text) > v_bytes then
    raise exception 'deck_too_large' using hint = format('Decks can be up to %s MB on your plan.', v_bytes / 1000000);
  end if;

  if tg_op = 'INSERT' then
    -- one insert at a time per user, so two tabs cannot both slip under the limit
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

drop trigger if exists decks_limits on public.decks;
drop trigger if exists decks_limits_add on public.decks;
drop trigger if exists decks_limits_change on public.decks;
create trigger decks_limits_add
  before insert on public.decks
  for each row execute function public.enforce_deck_limits();
-- only edits to the content count: sharing and view counts leave updated_at alone
create trigger decks_limits_change
  before update of name, data on public.decks
  for each row execute function public.enforce_deck_limits();

-------------------------------------------------------------------------------
-- Sharing
-------------------------------------------------------------------------------
-- Turns the public link on or off. The link id is random and hard to guess,
-- and it stays the same if you turn sharing off and on again.
create or replace function public.set_deck_sharing(p_deck uuid, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_slug text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select share_slug into v_slug from decks where id = p_deck and owner = auth.uid() for update;
  if not found then raise exception 'not_found'; end if;
  if v_slug is null then
    loop
      v_slug := translate(encode(gen_random_bytes(9), 'base64'), '+/', 'xy');
      exit when not exists (select 1 from decks where share_slug = v_slug);
    end loop;
  end if;
  update decks set share_slug = v_slug,
                   share_mode = case when p_on then 'link' else 'private' end
   where id = p_deck;
  return case when p_on then v_slug else null end;
end $$;

-- What a viewer of a shared link receives. Counts the view. (002_profiles.sql adds the author's name.)
drop function if exists public.get_shared_deck(text);
create function public.get_shared_deck(p_slug text)
returns table (name text, data jsonb, owner_plan text, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
    update decks d set view_count = d.view_count + 1
      from profiles p
     where d.share_slug = p_slug and d.share_mode = 'link' and p.id = d.owner
    returning d.name, d.data, p.plan, d.updated_at;
end $$;

revoke all on function public.set_deck_sharing(uuid, boolean) from public;
revoke all on function public.get_shared_deck(text) from public;
grant execute on function public.set_deck_sharing(uuid, boolean) to authenticated;
grant execute on function public.get_shared_deck(text) to anon, authenticated;

-------------------------------------------------------------------------------
-- Billing: called only by the payment webhook (with the service role key).
-------------------------------------------------------------------------------
create or replace function public.apply_subscription(
  p_user uuid, p_customer text, p_subscription text, p_status text,
  p_renews_at timestamptz, p_event_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from profiles
   where (p_user is not null and id = p_user)
      or (p_customer is not null and paddle_customer_id = p_customer)
   order by (id = p_user) desc nulls last
   limit 1;
  if v_id is null then return 'no_user'; end if;

  update profiles set
    plan                   = case when p_status in ('active', 'trialing', 'past_due') then 'pro' else 'free' end,
    paddle_customer_id     = coalesce(p_customer, paddle_customer_id),
    paddle_subscription_id = coalesce(p_subscription, paddle_subscription_id),
    subscription_status    = p_status,
    plan_renews_at         = p_renews_at,
    billing_updated_at     = p_event_at
  where id = v_id
    -- events can arrive out of order: an older event never overwrites a newer one
    and (billing_updated_at is null or billing_updated_at <= p_event_at);

  return case when found then 'updated' else 'stale' end;
end $$;

revoke all on function public.apply_subscription(uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_subscription(uuid, text, text, text, timestamptz, timestamptz) to service_role;
