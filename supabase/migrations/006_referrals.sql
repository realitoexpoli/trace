-- Tracé: invite friends. Safe to run again.
-- Everyone gets a personal invite link (traceanim.com/?ref=CODE). A friend counts once they have
-- confirmed their email and filled in their profile (name and role). Every 20 friends who count
-- give the inviter 1 month (30 days) of Pro, with no card, on top of any Pro they already have.
-- Change the two numbers in referral_rule() to change the deal.

alter table public.profiles add column if not exists ref_code         text;
alter table public.profiles add column if not exists referred_by      uuid references auth.users (id) on delete set null;
alter table public.profiles add column if not exists referred_at      timestamptz;
alter table public.profiles add column if not exists referral_rewards int not null default 0;
create unique index if not exists profiles_ref_code_key on public.profiles (ref_code);
create index if not exists profiles_referred_by_idx on public.profiles (referred_by);
-- (people cannot edit these columns themselves: only the columns granted in 002 can be changed)

create or replace function public.referral_rule()
returns table (per_reward int, reward_days int) language sql immutable as $$ select 20, 30 $$;

-- Friends of p_user who count: email confirmed and profile complete.
create or replace function public.referral_count(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from profiles f join auth.users u on u.id = f.id
   where f.referred_by = p_user and u.email_confirmed_at is not null and profile_complete(f.id);
$$;
revoke all on function public.referral_count(uuid) from public, anon, authenticated;

-- Hands out any month of Pro that has been earned and not given yet. Returns the number of new rewards.
create or replace function public.settle_referrals(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_prof profiles%rowtype; v_earned int; v_new int; r record;
begin
  select * into r from referral_rule();
  select * into v_prof from profiles where id = p_user for update;
  if not found then return 0; end if;
  v_earned := referral_count(p_user) / r.per_reward;
  v_new := v_earned - v_prof.referral_rewards;
  if v_new <= 0 then return 0; end if;
  update profiles
     set referral_rewards = v_earned,
         plan = 'pro',
         comp_until = greatest(coalesce(comp_until, now()), now()) + make_interval(days => v_new * r.reward_days),
         comp_code = coalesce(comp_code, 'INVITES')
   where id = p_user;
  return v_new;
end $$;
revoke all on function public.settle_referrals(uuid) from public, anon, authenticated;

-- The account page calls this: makes the invite code if needed, settles rewards, reports progress.
create or replace function public.my_referral()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_code text; v_new int; v_n int; r record; v_prof profiles%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into r from referral_rule();
  select ref_code into v_code from profiles where id = v_uid;
  while v_code is null loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 7));
    begin
      update profiles set ref_code = v_code where id = v_uid and ref_code is null;
    exception when unique_violation then v_code := null;
    end;
  end loop;
  v_new := settle_referrals(v_uid);
  v_n := referral_count(v_uid);
  select * into v_prof from profiles where id = v_uid;
  return jsonb_build_object('ok', true, 'code', v_code, 'friends', v_n, 'per_reward', r.per_reward,
    'reward_days', r.reward_days, 'next_in', r.per_reward - (v_n % r.per_reward), 'rewards', v_prof.referral_rewards,
    'new_rewards', v_new, 'comp_until', v_prof.comp_until);
end $$;
revoke all on function public.my_referral() from public, anon;
grant execute on function public.my_referral() to authenticated;

-- A new account opened from an invite link calls this once after signing in.
-- Answers {"ok": true} or {"ok": false, "error": "not_signed_in" | "invalid_code" | "own_code" | "already_invited" | "too_late"}.
create or replace function public.claim_referral(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_owner uuid; v_prof profiles%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into v_prof from profiles where id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if v_prof.referred_by is not null then return jsonb_build_object('ok', false, 'error', 'already_invited'); end if;
  if v_prof.created_at < now() - interval '7 days' then return jsonb_build_object('ok', false, 'error', 'too_late'); end if;
  select id into v_owner from profiles where ref_code = upper(btrim(coalesce(p_code, '')));
  if v_owner is null then return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;
  if v_owner = v_uid then return jsonb_build_object('ok', false, 'error', 'own_code'); end if;
  update profiles set referred_by = v_owner, referred_at = now() where id = v_uid;
  perform settle_referrals(v_owner);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;

-- When an invited friend completes their profile, the inviter may have earned a month: settle it then.
create or replace function public.referral_on_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.referred_by is not null and profile_complete(new.id) then perform settle_referrals(new.referred_by); end if;
  return null;
end $$;
drop trigger if exists profiles_referral_settle on public.profiles;
create trigger profiles_referral_settle after update of display_name, role on public.profiles
  for each row execute function public.referral_on_profile();

-------------------------------------------------------------------------------
-- Useful queries (run them yourself in the SQL editor)
-------------------------------------------------------------------------------
-- Top inviters:
--   select u.email, p.ref_code, referral_count(p.id) as friends, p.referral_rewards
--   from profiles p join auth.users u on u.id = p.id where p.ref_code is not null order by 3 desc;
