-- ============================================================================
-- Cursed Realm — The Archive only accepts legal decks
-- Run this once in the Supabase Dashboard → SQL Editor.
--
-- Background: "Inscribe in the Archive" flips decks.is_public to true. The gate
-- lived only in deckbuilder.html, so an illegal deck could still be published —
-- either by a stale page, or by anyone calling the REST API directly (RLS lets
-- an owner update their own row, and it has no opinion on deck contents). One
-- one-card deck did reach the public Archive that way.
--
-- This adds the same rule at the database level, which is the only place it
-- can't be bypassed. A deck may only be public when it is a legal build:
--   • exactly 1 Avatar
--   • 30+ Atlas sites
--   • 60+ Spellbook spells
--   • at most 10 Collection (sideboard) cards
--
-- Private decks are untouched — you can still save any half-built deck.
-- ============================================================================

-- deck_data payload shape (see buildDeckPayload() in deckbuilder.html):
--   { "n": name, "a": [[cardName, qty], …],  -- avatar
--                 "t": [[cardName, qty], …],  -- atlas
--                 "s": [[cardName, qty], …],  -- spellbook
--                 "c": [[cardName, qty], …],  -- collection
--                 "d": scroll }
-- Each section is an array of [name, qty] pairs, so a section's card count is
-- the sum of element 1 of every pair.
create or replace function public.deck_section_count(payload jsonb, section text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((pair -> 1)::integer), 0)::integer
  from jsonb_array_elements(
         case when jsonb_typeof(payload -> section) = 'array'
              then payload -> section
              else '[]'::jsonb
         end
       ) as pair
$$;

create or replace function public.decks_enforce_archive_legality()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  avatars    integer;
  atlas      integer;
  spellbook  integer;
  collection integer;
begin
  -- Only guard the public state; private decks may be any shape.
  if new.is_public is not true then
    return new;
  end if;

  avatars    := public.deck_section_count(new.deck_data, 'a');
  atlas      := public.deck_section_count(new.deck_data, 't');
  spellbook  := public.deck_section_count(new.deck_data, 's');
  collection := public.deck_section_count(new.deck_data, 'c');

  if avatars = 1 and atlas >= 30 and spellbook >= 60 and collection <= 10 then
    return new;
  end if;

  -- Illegal. Two cases, deliberately handled differently:
  --   • Publishing an illegal deck (insert, or private → public) is refused
  --     outright — that's the abuse this exists to stop.
  --   • Editing an already-public deck down into an illegal state quietly
  --     withdraws it instead of failing the save. Raising here would cost the
  --     user their edit, and the Archive still ends up clean either way. The
  --     deck builder re-renders the visibility bar after saving, so they see it
  --     flip back to Private.
  if tg_op = 'UPDATE' and old.is_public is true then
    new.is_public := false;
    return new;
  end if;

  raise exception
    'Deck is not legal for the Archive (Avatar %, Atlas %/30, Spellbook %/60, Collection %/10)',
    avatars, atlas, spellbook, collection
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists decks_archive_legality on public.decks;
create trigger decks_archive_legality
  before insert or update on public.decks
  for each row execute function public.decks_enforce_archive_legality();

-- ── One-off cleanup ─────────────────────────────────────────────────────────
-- Withdraw any deck that is already public but does not meet the requirements.
-- Run the SELECT first to see what would be affected.
--
--   select short_code, name, owner_id,
--          public.deck_section_count(deck_data, 'a') as avatars,
--          public.deck_section_count(deck_data, 't') as atlas,
--          public.deck_section_count(deck_data, 's') as spellbook,
--          public.deck_section_count(deck_data, 'c') as collection
--   from public.decks
--   where is_public
--     and (public.deck_section_count(deck_data, 'a') <> 1
--       or public.deck_section_count(deck_data, 't') < 30
--       or public.deck_section_count(deck_data, 's') < 60
--       or public.deck_section_count(deck_data, 'c') > 10);
--
--   update public.decks set is_public = false
--   where is_public
--     and (public.deck_section_count(deck_data, 'a') <> 1
--       or public.deck_section_count(deck_data, 't') < 30
--       or public.deck_section_count(deck_data, 's') < 60
--       or public.deck_section_count(deck_data, 'c') > 10);
