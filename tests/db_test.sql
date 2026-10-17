-- Tests for supabase/migrations/001 to 004. Run with tests/run_db_tests.sh (plain Postgres + stub).
\set ON_ERROR_STOP on
\pset tuples_only on
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'ana@example.com'),
                              ('22222222-2222-2222-2222-222222222222', 'ben@example.com');

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', what; end if; raise notice 'ok  %', what; end $$;

select pg_temp.check((select count(*) from profiles) = 2, 'a profile is created for each new account');

-- Ana signs in -------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- profile first: no cloud decks until it is complete
do $$ begin
  insert into decks (name, data) values ('Early', '{"slides":[]}');
  raise exception 'FAIL: a deck was saved before the profile was complete';
exception when others then
  if sqlerrm <> 'profile_required' then raise; end if; raise notice 'ok  no cloud decks before the profile is complete';
end $$;
update profiles set display_name = '  Ana Diaz  ' where id = auth.uid();
do $$ begin
  insert into decks (name, data) values ('Early', '{"slides":[]}');
  raise exception 'FAIL: a name alone was enough';
exception when others then
  if sqlerrm <> 'profile_required' then raise; end if; raise notice 'ok  a name alone is not enough (role needed too)';
end $$;
do $$ begin
  update profiles set role = 'wizard' where id = auth.uid();
  raise exception 'FAIL: unknown role accepted';
exception when check_violation then raise notice 'ok  unknown roles are refused';
end $$;
do $$ begin
  update profiles set avatar_color = 'red; drop table decks' where id = auth.uid();
  raise exception 'FAIL: bad colour accepted';
exception when check_violation then raise notice 'ok  avatar colour must be a #rrggbb colour';
end $$;
update profiles set role = 'teacher', subject = 'Physics', organization = 'Lycée Ibn Sina', avatar_color = '#22488a' where id = auth.uid();
select pg_temp.check((select display_name from profiles where id = auth.uid()) = 'Ana Diaz', 'names are trimmed');
select pg_temp.check((select profile_completed_at is not null from profiles where id = auth.uid()), 'completion time is recorded');
do $$ begin
  update profiles set plan = 'pro' where id = auth.uid();
  raise exception 'FAIL: user upgraded themselves through the profile';
exception when insufficient_privilege then raise notice 'ok  editing the profile cannot change the plan';
end $$;
do $$ begin
  update profiles set paddle_customer_id = 'ctm_steal' where id = auth.uid();
  raise exception 'FAIL: user set a billing id';
exception when insufficient_privilege then raise notice 'ok  editing the profile cannot change billing ids';
end $$;

insert into decks (name, data, client_id) values ('One', '{"slides":[]}', 'p1'), ('Two', '{"slides":[]}', 'p2'), ('Three', '{"slides":[]}', 'p3');
select pg_temp.check((select count(*) from decks) = 3, 'free user can keep 3 decks');

do $$ begin
  insert into decks (name, data) values ('Four', '{"slides":[]}');
  raise exception 'FAIL: fourth deck was allowed';
exception when others then
  if sqlerrm <> 'free_limit' then raise; end if; raise notice 'ok  fourth deck is refused with free_limit';
end $$;

do $$ begin
  update decks set data = jsonb_build_object('big', repeat('x', 2100000)) where name = 'One';
  raise exception 'FAIL: oversized deck was allowed';
exception when others then
  if sqlerrm <> 'deck_too_large' then raise; end if; raise notice 'ok  a deck over 2 MB is refused on free';
end $$;

do $$ begin
  update decks set data = '{"slides":[{"objects":[],"voice":{"0":{"id":"voice_a","dur":3}}}],"images":{"voice_a":"data:audio/webm;base64,AAAA"}}' where name = 'One';
  raise exception 'FAIL: a free account saved recorded voice';
exception when others then
  if sqlerrm <> 'voice_needs_pro' then raise; end if; raise notice 'ok  a free account cannot save a deck with recorded voice';
end $$;
update decks set data = '{"slides":[{"objects":[],"voice":{}}]}' where name = 'One';
select pg_temp.check(true, 'a deck whose voice clips were all deleted saves on free');

do $$ begin
  update decks set view_count = 999 where name = 'One';
  raise exception 'FAIL: user changed view_count';
exception when insufficient_privilege then raise notice 'ok  users cannot change view counts';
end $$;

do $$ begin
  update decks set share_slug = 'my-vanity' where name = 'One';
  raise exception 'FAIL: user set share_slug directly';
exception when insufficient_privilege then raise notice 'ok  users cannot pick share links directly';
end $$;

do $$ begin
  update profiles set plan = 'pro';
  raise exception 'FAIL: user upgraded themselves';
exception when insufficient_privilege then raise notice 'ok  users cannot give themselves Pro';
end $$;

-- sharing
select updated_at as before_share from decks where name = 'Two' \gset
select set_deck_sharing((select id from decks where name = 'Two'), true) as slug \gset
select pg_temp.check(length(:'slug') = 12, 'sharing returns a 12-character link id');
select pg_temp.check((select updated_at from decks where name = 'Two') = :'before_share'::timestamptz, 'sharing does not change the edit time');

-- Ben signs in --------------------------------------------------------------
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check((select count(*) from decks) = 0, 'Ben cannot see Ana''s decks');
select pg_temp.check((select count(*) from profiles) = 1, 'Ben sees only his own profile');
update profiles set display_name = 'Hacked' where id = '11111111-1111-1111-1111-111111111111';
update profiles set display_name = 'Ben', role = 'student' where id = auth.uid();
update decks set name = 'hacked';
delete from decks;
do $$ begin
  perform set_deck_sharing((select id from decks limit 1), true);
exception when others then raise notice 'ok  Ben cannot share a deck he does not own (%)', sqlerrm;
end $$;
do $$ begin
  insert into decks (name, data, owner) values ('sneaky', '{}', '11111111-1111-1111-1111-111111111111');
  raise exception 'FAIL: inserted a deck owned by someone else';
exception when insufficient_privilege then raise notice 'ok  Ben cannot create decks in Ana''s account';
end $$;

-- An anonymous viewer opens the link ---------------------------------------
reset request.jwt.claim.sub;
set role anon;
select pg_temp.check((select name from get_shared_deck(:'slug')) = 'Two', 'anyone with the link can open a shared deck');
select pg_temp.check((select owner_plan from get_shared_deck(:'slug')) = 'free', 'viewer knows the owner is on free (shows the badge)');
select pg_temp.check((select owner_name from get_shared_deck(:'slug')) = 'Ana Diaz', 'viewer sees who made the deck (and Ben could not rename Ana)');
select pg_temp.check((select count(*) from get_shared_deck('wrong-slug-00')) = 0, 'a wrong link shows nothing');
do $$ begin
  perform 1 from decks;
  raise exception 'FAIL: anon read the decks table';
exception when insufficient_privilege then raise notice 'ok  anonymous visitors cannot list decks';
end $$;
do $$ begin
  perform apply_subscription('11111111-1111-1111-1111-111111111111', null, null, 'active', null, now());
  raise exception 'FAIL: anon called apply_subscription';
exception when insufficient_privilege then raise notice 'ok  only the payment webhook can change plans';
end $$;

-- Ana turns sharing off ------------------------------------------------------
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check((select count(*) from decks where name = 'hacked') = 0 and (select count(*) from decks) = 3, 'Ben''s update and delete did nothing');
select pg_temp.check((select view_count from decks where name = 'Two') = 3, 'views are counted');
select pg_temp.check((select updated_at from decks where name = 'Two') = :'before_share'::timestamptz, 'views do not change the edit time');
select set_deck_sharing((select id from decks where name = 'Two'), false);
reset role;
set role anon;
select pg_temp.check((select count(*) from get_shared_deck(:'slug')) = 0, 'an unshared deck can no longer be opened');

-- Payments ---------------------------------------------------------------------
reset role;
set role service_role;
select pg_temp.check(apply_subscription('11111111-1111-1111-1111-111111111111', 'ctm_1', 'sub_1', 'active', now() + interval '1 month', '2026-10-01 10:00+00') = 'updated', 'webhook activates Pro');
select pg_temp.check((select plan from profiles where email = 'ana@example.com') = 'pro', 'Ana is now Pro');
select pg_temp.check(apply_subscription(null, 'ctm_1', 'sub_1', 'canceled', null, '2026-09-30 10:00+00') = 'stale', 'an older event arriving late is ignored');
select pg_temp.check((select plan from profiles where email = 'ana@example.com') = 'pro', 'Ana stays Pro after the stale event');

reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into decks (name, data) values ('Four', '{"slides":[]}'), ('Five', '{"slides":[]}');
select pg_temp.check((select count(*) from decks) = 5, 'Pro can keep more than 3 decks');
update decks set data = jsonb_build_object('big', repeat('x', 2100000)) where name = 'One';
select pg_temp.check(true, 'Pro can save a 2 MB+ deck');
update decks set data = '{"slides":[{"objects":[],"voice":{"0":{"id":"voice_a","dur":3}}}],"images":{"voice_a":"data:audio/webm;base64,AAAA"}}' where name = 'Two';
select pg_temp.check(deck_has_voice((select data from decks where name = 'Two')), 'Pro can save recorded voice');

reset role;
set role service_role;
select pg_temp.check(apply_subscription(null, 'ctm_1', 'sub_1', 'canceled', null, '2026-11-01 10:00+00') = 'updated', 'cancellation by customer id');
select pg_temp.check((select plan from profiles where email = 'ana@example.com') = 'free', 'Ana is back on free');
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check((select count(*) from decks) = 5, 'after downgrading, existing decks are kept');
update decks set name = 'Four (edited)' where name = 'Four';
select pg_temp.check(true, 'and can still be edited');
do $$ begin
  insert into decks (name, data) values ('Six', '{"slides":[]}');
  raise exception 'FAIL: sixth deck allowed on free';
exception when others then
  if sqlerrm <> 'free_limit' then raise; end if; raise notice 'ok  but no new cloud decks until under the limit or Pro';
end $$;
reset role;
select pg_temp.check((select count(*) from profiles where paddle_customer_id = 'ctm_1') = 1, 'customer id stored for the billing portal');

-- deleting your own account
reset role;
set role service_role;
select apply_subscription('11111111-1111-1111-1111-111111111111', 'ctm_1', 'sub_2', 'active', null, '2026-12-01 10:00+00');
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform delete_my_account();
  raise exception 'FAIL: deleted an account with a running subscription';
exception when others then
  if sqlerrm <> 'cancel_subscription_first' then raise; end if; raise notice 'ok  a running subscription must be cancelled before deleting the account';
end $$;
reset role;
set role anon;
do $$ begin
  perform delete_my_account();
  raise exception 'FAIL: anon called delete_my_account';
exception when insufficient_privilege then raise notice 'ok  visitors cannot delete accounts';
end $$;
reset role;
set role service_role;
select apply_subscription(null, 'ctm_1', 'sub_2', 'canceled', null, '2026-12-02 10:00+00');
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select delete_my_account();
reset role;
select pg_temp.check((select count(*) from auth.users where email = 'ana@example.com') = 0, 'after cancelling, people can delete their own account');
delete from auth.users where email = 'ana@example.com';
select pg_temp.check((select count(*) from decks) = 0 and (select count(*) from profiles) = 1, 'deleting an account deletes its decks and profile');

-- Promo codes (004_promo_codes.sql) ------------------------------------------------
reset role;
insert into auth.users values ('33333333-3333-3333-3333-333333333333', 'cleo@example.com'),
                              ('44444444-4444-4444-4444-444444444444', 'dan@example.com'),
                              ('55555555-5555-5555-5555-555555555555', 'eve@example.com');
insert into promo_codes (code, days, max_uses, note) values ('FOUNDERS-2026', 60, 2, 'test');
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
update profiles set display_name = 'Cleo', role = 'teacher' where id = auth.uid();
select pg_temp.check(redeem_promo('NOPE-0000')->>'error' = 'invalid_code', 'an unknown code is refused');
select pg_temp.check((redeem_promo('  founders-2026 ')->>'ok')::boolean, 'a code works in any case and with spaces');
select pg_temp.check((select plan = 'pro' and comp_until between now() + interval '59 days' and now() + interval '61 days' from profiles where id = auth.uid()), 'the code gives Pro for 60 days');
select pg_temp.check(redeem_promo('FOUNDERS-2026')->>'error' = 'already_redeemed', 'an account can use a code only once');
do $$ begin
  perform * from promo_codes;
  raise exception 'FAIL: user read the codes';
exception when insufficient_privilege then raise notice 'ok  nobody can list the codes from the browser';
end $$;
do $$ begin
  update profiles set comp_until = now() + interval '10 years' where id = auth.uid();
  raise exception 'FAIL: user extended their gift';
exception when insufficient_privilege then raise notice 'ok  people cannot extend their free Pro themselves';
end $$;
insert into decks (name, data) values ('Voice', '{"slides":[{"objects":[],"voice":{"0":{"id":"v","dur":1}}}]}');
select pg_temp.check(true, 'free Pro from a code allows Pro features (voice)');
reset role;
select pg_temp.check((select count(*) from promo_attempts where user_id = '33333333-3333-3333-3333-333333333333') = 1, 'failed attempts are counted');

set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
update profiles set display_name = 'Dan', role = 'student' where id = auth.uid();
select pg_temp.check((redeem_promo('FOUNDERS-2026')->>'ok')::boolean, 'a second person uses the same code');
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select pg_temp.check(redeem_promo('FOUNDERS-2026')->>'error' = 'code_used_up', 'when its uses are gone, the code stops working');
select redeem_promo('WRONG-' || g) from generate_series(1, 10) g;
select pg_temp.check(redeem_promo('FOUNDERS-2026')->>'error' = 'too_many_attempts', 'after 10 wrong codes in a day, trying is paused');
reset role;
set role anon;
do $$ begin
  perform redeem_promo('FOUNDERS-2026');
  raise exception 'FAIL: anon redeemed';
exception when insufficient_privilege then raise notice 'ok  visitors who are not signed in cannot redeem';
end $$;

-- the 60 days are over for Dan
reset role;
update profiles set comp_until = now() - interval '1 day' where email = 'dan@example.com';
select pg_temp.check(plan_of('44444444-4444-4444-4444-444444444444') = 'free', 'when the gift ends, the account counts as Free at once');
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  insert into decks (name, data) values ('Voice', '{"slides":[{"objects":[],"voice":{"0":{"id":"v","dur":1}}}]}');
  raise exception 'FAIL: voice saved after the gift ended';
exception when others then
  if sqlerrm <> 'voice_needs_pro' then raise; end if; raise notice 'ok  and Pro features stop';
end $$;
select pg_temp.check(refresh_my_plan() = 'free', 'refreshing the plan says Free');
select pg_temp.check((select plan from profiles where id = auth.uid()) = 'free', 'signing in turns the ended gift back to Free');

-- Cleo subscribes during her gift, then cancels: she keeps Pro until the gift ends
reset role;
set role service_role;
select apply_subscription('33333333-3333-3333-3333-333333333333', 'ctm_c', 'sub_c', 'active', null, '2026-10-05 10:00+00');
select apply_subscription(null, 'ctm_c', 'sub_c', 'canceled', null, '2026-10-06 10:00+00');
select pg_temp.check((select plan from profiles where email = 'cleo@example.com') = 'pro', 'cancelling a subscription keeps Pro while a gift is running');
reset role;
update profiles set comp_until = now() - interval '1 hour' where email = 'cleo@example.com';
select pg_temp.check(expire_comp_plans() >= 1, 'the hourly clean-up finds finished gifts');
select pg_temp.check((select plan from profiles where email = 'cleo@example.com') = 'free', 'and turns them back to Free');
select pg_temp.check((select count(*) from decks where name = 'Voice') = 1, 'no deck is deleted when a gift ends');

-- Invite friends (006) -----------------------------------------------------
reset role;
insert into auth.users (id, email) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'cara@example.com');
insert into auth.users (id, email, email_confirmed_at)
  select ('dddddddd-dddd-dddd-dddd-' || lpad(g::text, 12, '0'))::uuid, 'friend' || g || '@example.com', case when g = 21 then null else now() end
  from generate_series(1, 21) g;
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select set_config('t.code', my_referral()->>'code', false);
select pg_temp.check(length(current_setting('t.code')) = 7, 'everyone gets a personal invite code');
select pg_temp.check(my_referral()->>'code' = current_setting('t.code'), 'the invite code stays the same');
select pg_temp.check(claim_referral(current_setting('t.code'))->>'error' = 'own_code', 'you cannot invite yourself');
do $$ begin update profiles set referral_rewards = 99 where id = auth.uid(); raise exception 'FAIL: rewards could be edited';
exception when insufficient_privilege then raise notice 'ok  nobody can give themselves invite rewards'; end $$;
do $$ declare g int; begin
  for g in 1..21 loop
    perform set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-' || lpad(g::text, 12, '0'), false);
    if (claim_referral(lower(current_setting('t.code')))->>'ok')::boolean is not true then raise exception 'FAIL: friend % could not use the link', g; end if;
    if g < 20 or g = 21 then update profiles set display_name = 'Friend ' || g, role = 'teacher' where id = auth.uid(); end if;
  end loop; end $$;
select pg_temp.check(claim_referral(current_setting('t.code'))->>'error' = 'already_invited', 'a friend can be counted only once');
select pg_temp.check(claim_referral('ZZZZZZZ')->>'error' = 'already_invited' or claim_referral('ZZZZZZZ')->>'error' = 'invalid_code', 'an unknown invite code is refused');
reset role;
select pg_temp.check(referral_count('cccccccc-cccc-cccc-cccc-cccccccccccc') = 19, 'friends count only once confirmed with a complete profile (19 so far)');
select pg_temp.check(plan_of('cccccccc-cccc-cccc-cccc-cccccccccccc') = 'free', 'no reward before 20 friends');
set role authenticated;
set request.jwt.claim.sub = 'dddddddd-dddd-dddd-dddd-000000000020';
update profiles set display_name = 'Friend 20', role = 'student' where id = auth.uid();
reset role;
select pg_temp.check(plan_of('cccccccc-cccc-cccc-cccc-cccccccccccc') = 'pro', 'the 20th friend gives the inviter Pro');
select pg_temp.check((select comp_until between now() + interval '29 days' and now() + interval '31 days' from profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'), 'for one month, with no card');
select pg_temp.check((select referral_rewards from profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') = 1, 'the reward is given once');
set role authenticated;
set request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select pg_temp.check((my_referral()->>'friends')::int = 20 and (my_referral()->>'next_in')::int = 20 and (my_referral()->>'new_rewards')::int = 0, 'the account page shows 20 friends and 20 more for the next month');
reset role;
update profiles set created_at = now() - interval '8 days' where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check(claim_referral(current_setting('t.code'))->>'error' = 'too_late', 'old accounts cannot use an invite link');
reset role;
-- AI credits: 5 to try, 30 a month on Pro, packs; only the server can spend or add them
set role service_role;
select pg_temp.check((ai_take_credit('dddddddd-dddd-dddd-dddd-000000000001')->>'left')::int = 4, 'every account gets 5 credits to try the AI (4 left after one)');
select ai_take_credit('dddddddd-dddd-dddd-dddd-000000000001') from generate_series(1, 4);
select pg_temp.check(ai_take_credit('dddddddd-dddd-dddd-dddd-000000000001')->>'error' = 'no_credits', 'after 5 a free account has no credits left');
select pg_temp.check((select bought from ai_wallet where user_id = 'dddddddd-dddd-dddd-dddd-000000000001') = 0, 'the trial is given only once');
select pg_temp.check(ai_add_credits('dddddddd-dddd-dddd-dddd-000000000001', 50, 'txn_1') = 'added', 'a paid pack adds credits');
select pg_temp.check(ai_add_credits('dddddddd-dddd-dddd-dddd-000000000001', 50, 'txn_1') = 'duplicate', 'the same payment twice adds them once');
select pg_temp.check(ai_add_credits('99999999-9999-9999-9999-999999999999', 50, 'txn_2') = 'no_user', 'a payment for an unknown account is refused');
select pg_temp.check((ai_take_credit('dddddddd-dddd-dddd-dddd-000000000001')->>'left')::int = 49, 'bought credits can be used');
select ai_refund_credit('dddddddd-dddd-dddd-dddd-000000000001', 'bought');
select pg_temp.check((select bought from ai_wallet where user_id = 'dddddddd-dddd-dddd-dddd-000000000001') = 50, 'a failed request gives its credit back');
select pg_temp.check((ai_take_credit('cccccccc-cccc-cccc-cccc-cccccccccccc')->>'from') = 'month' and (select month_left from ai_wallet where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') = 29, 'Pro gets 30 credits a month, used before bought ones');
select ai_take_credit('cccccccc-cccc-cccc-cccc-cccccccccccc') from generate_series(1, 29);
select pg_temp.check((ai_take_credit('cccccccc-cccc-cccc-cccc-cccccccccccc')->>'from') = 'bought', 'then the trial or bought credits are used');
reset role;
update ai_wallet set month_start = (date_trunc('month', now()) - interval '1 month')::date where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
set role service_role;
select pg_temp.check((ai_take_credit('cccccccc-cccc-cccc-cccc-cccccccccccc')->>'month_left')::int = 29, 'a new month brings 30 fresh Pro credits (no roll-over)');
reset role;
set role authenticated;
set request.jwt.claim.sub = 'dddddddd-dddd-dddd-dddd-000000000001';
select pg_temp.check((my_ai_credits()->>'left')::int = 50 and (my_ai_credits()->>'pro')::boolean = false, 'people can see their own credits');
do $$ begin perform ai_take_credit(auth.uid()); raise exception 'FAIL: a user could take a credit directly';
exception when insufficient_privilege then raise notice 'ok  only the server can spend AI credits'; end $$;
do $$ begin perform ai_add_credits(auth.uid(), 1000, 'free'); raise exception 'FAIL: a user could add credits';
exception when insufficient_privilege then raise notice 'ok  nobody can give themselves credits'; end $$;
do $$ begin if exists (select 1 from ai_wallet) or exists (select 1 from ai_purchases) then raise exception 'FAIL: wallets readable'; end if; raise notice 'ok  wallets and purchases are private';
exception when insufficient_privilege then raise notice 'ok  wallets and purchases are private'; end $$;
reset role;
\echo ALL DATABASE TESTS PASSED
