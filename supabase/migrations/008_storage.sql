-- Online storage limits per plan: number of decks, size of one deck, and total space for one account.
-- Change the numbers in plan_storage() and they apply everywhere (the app reads them through my_storage()).
-- Safe to run more than once.

create or replace function public.plan_storage(p_plan text)
returns table (max_decks int, max_deck_bytes int, max_total_bytes bigint)
language sql immutable as $$
  select case when p_plan = 'pro' then 50 else 3 end,
         case when p_plan = 'pro' then 20000000 else 2000000 end,
         case when p_plan = 'pro' then 200000000::bigint else 5000000::bigint end;
$$;

-- older code reads plan_limits(); keep it in step
create or replace function public.plan_limits(p_plan text)
returns table (max_decks int, max_deck_bytes int)
language sql immutable as $$
  select max_decks, max_deck_bytes from public.plan_storage(p_plan);
$$;

create or replace function public.enforce_deck_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plan  text;
  v_max   int;
  v_bytes int;
  v_total bigint;
  v_used  bigint;
  v_count int;
  v_size  int := octet_length(new.data::text);
begin
  if not profile_complete(new.owner) then
    raise exception 'profile_required' using hint = 'Finish your profile to save projects online.';
  end if;

  v_plan := plan_of(new.owner);
  select max_decks, max_deck_bytes, max_total_bytes into v_max, v_bytes, v_total from plan_storage(v_plan);

  if v_size > v_bytes then
    raise exception 'deck_too_large' using hint = format('Decks can be up to %s MB on your plan.', v_bytes / 1000000);
  end if;

  if v_plan <> 'pro' and deck_has_voice(new.data) then
    raise exception 'voice_needs_pro' using hint = 'Recorded voice is part of Tracé Pro.';
  end if;

  -- one save at a time per user, so two tabs cannot both slip under a limit
  perform pg_advisory_xact_lock(hashtext(new.owner::text));

  select coalesce(sum(octet_length(data::text)), 0) into v_used
    from decks where owner = new.owner and id <> new.id;
  -- an existing deck that does not grow can always be saved, even above the limit (e.g. after cancelling Pro)
  if v_used + v_size > v_total
     and (tg_op = 'INSERT' or v_size > octet_length(old.data::text)) then
    raise exception 'storage_full' using hint = format('Your online space is full (%s MB on your plan).', v_total / 1000000);
  end if;

  if tg_op = 'INSERT' then
    select count(*) into v_count from decks where owner = new.owner;
    if v_count >= v_max then
      if v_plan = 'pro' then
        raise exception 'pro_limit' using hint = format('Pro keeps %s decks online.', v_max);
      end if;
      raise exception 'free_limit' using hint = format('The free plan keeps %s decks in the cloud.', v_max);
    end if;
  else
    new.updated_at := now();
  end if;
  return new;
end $$;

-- What the signed-in user has online, and the limits of their plan (for the account menu and page)
create or replace function public.my_storage()
returns table (decks int, used_bytes bigint, max_decks int, max_deck_bytes int, max_total_bytes bigint, plan text)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from decks where owner = auth.uid()),
         (select coalesce(sum(octet_length(data::text)), 0)::bigint from decks where owner = auth.uid()),
         s.max_decks, s.max_deck_bytes, s.max_total_bytes, plan_of(auth.uid())
    from plan_storage(plan_of(auth.uid())) s
   where auth.uid() is not null;
$$;
revoke all on function public.my_storage() from public, anon;
grant execute on function public.my_storage() to authenticated;
