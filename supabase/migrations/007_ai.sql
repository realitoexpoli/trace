-- Tracé: AI credits. Safe to run again.
-- 1 credit = 1 AI request (a new deck, or slides added to one).
--   * every account gets 5 credits to try it (once, they never expire);
--   * Pro accounts get 30 credits each calendar month (unused ones do not carry over);
--   * anyone can buy packs of credits through Paddle (they never expire).
-- Monthly Pro credits are used first, then bought ones. A request that fails is given back.
-- Change the numbers in ai_rule().

create table if not exists public.ai_wallet (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  month_start  date,                     -- the month the Pro credits below belong to
  month_left   int  not null default 0,  -- Pro credits left this month
  bought       int  not null default 0,  -- trial + bought credits (never expire)
  trial_given  boolean not null default false,
  used_total   int  not null default 0,
  updated_at   timestamptz not null default now()
);
alter table public.ai_wallet enable row level security;   -- no policies: nobody reads or writes it directly

-- Every pack bought, once per Paddle transaction (so a webhook sent twice adds the credits once).
create table if not exists public.ai_purchases (
  txn_id     text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  credits    int  not null,
  created_at timestamptz not null default now()
);
alter table public.ai_purchases enable row level security;

-- (an earlier draft of this file had daily limits; those functions are removed)
drop function if exists public.ai_limit(uuid);
drop function if exists public.my_ai_usage();
drop function if exists public.ai_refund_credit(uuid);

create or replace function public.ai_rule()
returns table (trial int, pro_monthly int) language sql immutable as $$ select 5, 30 $$;

-- Makes sure the wallet exists, gives the trial once and refreshes the Pro credits for this month.
create or replace function public.ai_wallet_fresh(p_user uuid)
returns public.ai_wallet language plpgsql security definer set search_path = public as $$
declare w ai_wallet; r record; v_month date := date_trunc('month', now())::date; v_pro boolean := plan_of(p_user) = 'pro';
begin
  select * into r from ai_rule();
  insert into ai_wallet (user_id) values (p_user) on conflict do nothing;
  select * into w from ai_wallet where user_id = p_user for update;
  if not w.trial_given then w.bought := w.bought + r.trial; w.trial_given := true; end if;
  if v_pro and w.month_start is distinct from v_month then w.month_start := v_month; w.month_left := r.pro_monthly; end if;
  if not v_pro then w.month_left := 0; w.month_start := null; end if;
  update ai_wallet set bought = w.bought, trial_given = w.trial_given, month_start = w.month_start, month_left = w.month_left, updated_at = now()
   where user_id = p_user;
  return w;
end $$;

-- The server takes one credit before asking the AI.
-- Answers {"ok":true,"from":"month"|"bought","left":n,...} or {"ok":false,"error":"no_credits","pro":bool}.
create or replace function public.ai_take_credit(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w ai_wallet; v_from text;
begin
  w := ai_wallet_fresh(p_user);
  if w.month_left > 0 then v_from := 'month'; w.month_left := w.month_left - 1;
  elsif w.bought > 0 then v_from := 'bought'; w.bought := w.bought - 1;
  else return jsonb_build_object('ok', false, 'error', 'no_credits', 'pro', plan_of(p_user) = 'pro'); end if;
  update ai_wallet set month_left = w.month_left, bought = w.bought, used_total = used_total + 1, updated_at = now() where user_id = p_user;
  return jsonb_build_object('ok', true, 'from', v_from, 'left', w.month_left + w.bought, 'month_left', w.month_left, 'bought', w.bought);
end $$;

-- Gives a credit back when the AI failed (to the same place it came from).
create or replace function public.ai_refund_credit(p_user uuid, p_from text)
returns void language sql security definer set search_path = public as $$
  update ai_wallet set
    month_left = month_left + case when p_from = 'month' then 1 else 0 end,
    bought     = bought     + case when p_from = 'month' then 0 else 1 end,
    used_total = greatest(0, used_total - 1), updated_at = now()
  where user_id = p_user;
$$;

-- A pack was paid for (called by the Paddle webhook). Returns 'added', 'duplicate', 'ignored' or 'no_user'.
create or replace function public.ai_add_credits(p_user uuid, p_credits int, p_txn text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then return 'no_user'; end if;
  if p_credits is null or p_credits <= 0 or p_txn is null then return 'ignored'; end if;
  insert into ai_purchases (txn_id, user_id, credits) values (p_txn, p_user, p_credits) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  perform ai_wallet_fresh(p_user);
  update ai_wallet set bought = bought + p_credits, updated_at = now() where user_id = p_user;
  return 'added';
end $$;

revoke all on function public.ai_wallet_fresh(uuid) from public, anon, authenticated;
revoke all on function public.ai_take_credit(uuid) from public, anon, authenticated;
revoke all on function public.ai_refund_credit(uuid, text) from public, anon, authenticated;
revoke all on function public.ai_add_credits(uuid, int, text) from public, anon, authenticated;
grant execute on function public.ai_take_credit(uuid) to service_role;
grant execute on function public.ai_refund_credit(uuid, text) to service_role;
grant execute on function public.ai_add_credits(uuid, int, text) to service_role;

-- The editor shows "27 credits left". Signed-in people only see their own.
create or replace function public.my_ai_credits()
returns jsonb language plpgsql security definer set search_path = public as $$
declare w ai_wallet; r record;
begin
  if auth.uid() is null then return null; end if;
  select * into r from ai_rule();
  w := ai_wallet_fresh(auth.uid());
  return jsonb_build_object('left', w.month_left + w.bought, 'month_left', w.month_left, 'bought', w.bought,
    'pro', plan_of(auth.uid()) = 'pro', 'pro_monthly', r.pro_monthly, 'trial', r.trial);
end $$;
revoke all on function public.my_ai_credits() from public, anon;
grant execute on function public.my_ai_credits() to authenticated;

-------------------------------------------------------------------------------
-- Useful queries (run them yourself in the SQL editor)
-------------------------------------------------------------------------------
-- Give someone 20 credits by hand:  select ai_add_credits((select id from auth.users where email = 'x@y.com'), 20, 'gift-' || now());
-- Who uses the AI most:             select u.email, w.used_total, w.month_left, w.bought from ai_wallet w join auth.users u on u.id = w.user_id order by 2 desc limit 20;
-- Packs sold per month:             select date_trunc('month', created_at) m, count(*), sum(credits) from ai_purchases group by 1 order by 1 desc;
