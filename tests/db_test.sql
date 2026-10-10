-- Tests for supabase/migrations/001_init.sql and 002_profiles.sql. Run with tests/run_db_tests.sh (plain Postgres + stub).
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
\echo ALL DATABASE TESTS PASSED
