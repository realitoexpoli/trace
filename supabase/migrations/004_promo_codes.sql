-- Tracé: promo codes that give Pro for a while, with no card.
-- Run after 001, 002 and 003. Safe to run again.
--
-- How it works
-- - You create codes in the SQL editor (see the end of this file, or the README).
-- - Someone signed in types a code on their account page or in the Pro window.
-- - Their account becomes Pro until profiles.comp_until (60 days by default), then goes back to Free
--   by itself, unless they subscribed in the meantime. Nothing is deleted when it ends.
-- - Each account can use one code, once. Each code has a number of uses (for example 20).

alter table public.profiles add column if not exists comp_until timestamptz;
alter table public.profiles add column if not exists comp_code  text;

create table if not exists public.promo_codes (
  code        text primary key check (code = upper(code) and code ~ '^[A-Z0-9-]{4,40}$'),
  days        int  not null default 60 check (days between 1 and 366),
  max_uses    int  not null default 1  check (max_uses >= 1),
  uses        int  not null default 0,
  expires_at  timestamptz,                -- after this date the code cannot be used (optional)
  note        text,
  created_at  timestamptz not null default now()
);
create table if not exists public.promo_redemptions (
  code        text not null references public.promo_codes (code) on delete cascade,
  user_id     uuid not null unique references auth.users (id) on delete cascade,   -- one code per account
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);
-- Nobody reads or writes these tables from the browser; only the function below does.
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
revoke all on public.promo_codes, public.promo_redemptions from anon, authenticated;

-- A failed attempt is noted so codes cannot be guessed by trying many (10 a day per account).
create table if not exists public.promo_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists promo_attempts_user on public.promo_attempts (user_id, at);
alter table public.promo_attempts enable row level security;
revoke all on public.promo_attempts from anon, authenticated;

-------------------------------------------------------------------------------
-- The plan that counts right now: a gifted Pro ends at comp_until unless a subscription is running.
-------------------------------------------------------------------------------
create or replace function public.plan_of(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when plan = 'pro' and comp_until is not null and comp_until < now()
           and coalesce(subscription_status, '') not in ('active', 'trialing', 'past_due') then 'free'
      else plan end
    from profiles where id = p_user), 'free');
$$;

-- Turns finished gifts back to Free in the table too (run hourly by pg_cron when available, and on sign-in).
create or replace function public.expire_comp_plans()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update profiles set plan = 'free'
   where plan = 'pro' and comp_until is not null and comp_until < now()
     and coalesce(subscription_status, '') not in ('active', 'trialing', 'past_due');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_comp_plans() from public, anon, authenticated;

-- The browser calls this when it loads the account: it ends a finished gift for this account only.
create or replace function public.refresh_my_plan()
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 'free'; end if;
  update profiles set plan = 'free'
   where id = auth.uid() and plan = 'pro' and comp_until is not null and comp_until < now()
     and coalesce(subscription_status, '') not in ('active', 'trialing', 'past_due');
  return plan_of(auth.uid());
end $$;
revoke all on function public.refresh_my_plan() from public, anon;
grant execute on function public.refresh_my_plan() to authenticated;

-------------------------------------------------------------------------------
-- Redeeming a code
-------------------------------------------------------------------------------
-- Returns {"ok": true, "until": "..."} or {"ok": false, "error": "invalid_code" | "code_used_up" |
-- "already_redeemed" | "already_subscribed" | "too_many_attempts" | "not_signed_in"}.
-- (It answers instead of raising an error, so that failed attempts are kept and counted.)
drop function if exists public.redeem_promo(text);
create function public.redeem_promo(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_row  promo_codes%rowtype;
  v_prof profiles%rowtype;
  v_until timestamptz;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if (select count(*) from promo_attempts where user_id = v_uid and at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  select * into v_prof from profiles where id = v_uid for update;
  if v_prof.subscription_status in ('active', 'trialing', 'past_due') then
    return jsonb_build_object('ok', false, 'error', 'already_subscribed');
  end if;
  if exists (select 1 from promo_redemptions where user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'already_redeemed');
  end if;

  select * into v_row from promo_codes where code = v_code for update;
  if not found or (v_row.expires_at is not null and v_row.expires_at < now()) then
    insert into promo_attempts (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if v_row.uses >= v_row.max_uses then
    return jsonb_build_object('ok', false, 'error', 'code_used_up');
  end if;

  update promo_codes set uses = uses + 1 where code = v_code;
  insert into promo_redemptions (code, user_id) values (v_code, v_uid);
  v_until := greatest(coalesce(v_prof.comp_until, now()), now()) + make_interval(days => v_row.days);
  update profiles set plan = 'pro', comp_until = v_until, comp_code = v_code where id = v_uid;
  return jsonb_build_object('ok', true, 'until', v_until, 'days', v_row.days);
end $$;
revoke all on function public.redeem_promo(text) from public, anon;
grant execute on function public.redeem_promo(text) to authenticated;

-------------------------------------------------------------------------------
-- Limits, share links and the payment webhook follow plan_of() (so a finished gift counts as Free)
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

  v_plan := plan_of(new.owner);
  select max_decks, max_deck_bytes into v_max, v_bytes from plan_limits(v_plan);

  if octet_length(new.data::text) > v_bytes then
    raise exception 'deck_too_large' using hint = format('Decks can be up to %s MB on your plan.', v_bytes / 1000000);
  end if;

  if v_plan <> 'pro' and deck_has_voice(new.data) then
    raise exception 'voice_needs_pro' using hint = 'Recorded voice is part of Tracé Pro.';
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

drop function if exists public.get_shared_deck(text);
create function public.get_shared_deck(p_slug text)
returns table (name text, data jsonb, owner_plan text, updated_at timestamptz, owner_name text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    update decks d set view_count = d.view_count + 1
      from profiles p
     where d.share_slug = p_slug and d.share_mode = 'link' and p.id = d.owner
    returning d.name, d.data, plan_of(p.id), d.updated_at, p.display_name;
end $$;
revoke all on function public.get_shared_deck(text) from public;
grant execute on function public.get_shared_deck(text) to anon, authenticated;

-- Same as in 001, except that cancelling a subscription keeps Pro while a gift is still running.
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
    plan                   = case when p_status in ('active', 'trialing', 'past_due') then 'pro'
                                  when comp_until is not null and comp_until > now() then 'pro'
                                  else 'free' end,
    paddle_customer_id     = coalesce(p_customer, paddle_customer_id),
    paddle_subscription_id = coalesce(p_subscription, paddle_subscription_id),
    subscription_status    = p_status,
    plan_renews_at         = p_renews_at,
    billing_updated_at     = p_event_at
  where id = v_id
    and (billing_updated_at is null or billing_updated_at <= p_event_at);

  return case when found then 'updated' else 'stale' end;
end $$;
revoke all on function public.apply_subscription(uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_subscription(uuid, text, text, text, timestamptz, timestamptz) to service_role;

-- Hourly clean-up with pg_cron (Supabase: Database → Extensions → pg_cron). Skipped quietly if it is not there.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('trace-expire-gifts') where exists (select 1 from cron.job where jobname = 'trace-expire-gifts');
    perform cron.schedule('trace-expire-gifts', '7 * * * *', 'select public.expire_comp_plans()');
  end if;
exception when others then null; end $$;

-------------------------------------------------------------------------------
-- Making codes (run these yourself in the SQL editor; they are not run by this file)
-------------------------------------------------------------------------------
-- One code that the first 20 people can use, each getting 60 days of Pro:
--   insert into promo_codes (code, days, max_uses, note) values ('FOUNDERS-2026', 60, 20, 'First 20 users');
--
-- Or 20 personal codes, one use each (then list them with the select below):
--   insert into promo_codes (code, days, max_uses, note)
--   select 'TRACE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)), 60, 1, 'Founders batch'
--   from generate_series(1, 20);
--   select code, uses, max_uses from promo_codes where note = 'Founders batch' order by created_at;
--
-- Who used what:
--   select r.code, u.email, r.redeemed_at, p.comp_until from promo_redemptions r
--   join auth.users u on u.id = r.user_id join profiles p on p.id = r.user_id order by r.redeemed_at;
