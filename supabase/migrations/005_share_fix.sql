-- Fix: "function gen_random_bytes(integer) does not exist" when turning on a share link.
-- On Supabase, pgcrypto lives in the "extensions" schema, which the sharing function could not see.
-- The share code now comes from gen_random_uuid(), which is built into Postgres. Safe to run again.
create or replace function public.set_deck_sharing(p_deck uuid, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_slug text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select share_slug into v_slug from decks where id = p_deck and owner = auth.uid() for update;
  if not found then raise exception 'not_found'; end if;
  if v_slug is null then
    loop
      v_slug := left(translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/=', 'xy'), 12);
      exit when not exists (select 1 from decks where share_slug = v_slug);
    end loop;
  end if;
  update decks set share_slug = v_slug,
                   share_mode = case when p_on then 'link' else 'private' end
   where id = p_deck;
  return case when p_on then v_slug else null end;
end $$;
