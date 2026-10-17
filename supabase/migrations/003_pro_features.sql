-- Tracé: Pro features (recorded voice on slides).
-- Run after 001_init.sql and 002_profiles.sql. Safe to run again.
--
-- Advanced 3D and the Python video script are unlocked in the editor by the account's plan.
-- Recorded voice is also checked here, because voice clips are stored inside the deck:
-- a free account cannot save a deck that holds recordings.

create or replace function public.deck_has_voice(d jsonb)
returns boolean language sql immutable as $$
  select exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(d->'slides') = 'array' then d->'slides' else '[]'::jsonb end) s
    where jsonb_typeof(s->'voice') = 'object' and s->'voice' <> '{}'::jsonb
  )
$$;

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
