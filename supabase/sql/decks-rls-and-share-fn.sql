-- ============================================================================
-- Cursed Realm — decks table: lock down RLS + keep private decks link-shareable
-- Run this once in the Supabase Dashboard → SQL Editor.
--
-- Fixes two confirmed issues:
--   1) SELECT was fully public — anyone could bulk-read (enumerate) every private
--      deck's contents. Now only public decks (or your own) are readable via the
--      table, and a SECURITY DEFINER function serves a single deck by its exact
--      share code so "view/share by link" still works for private (unlisted) decks.
--   2) INSERT wasn't owner-scoped — anyone could create/publish decks as any user.
--      Now you can only insert/update/delete rows you own, as yourself.
-- ============================================================================

-- 1) Share-by-link function: returns ONE deck by its exact short_code, bypassing
--    RLS (definer's rights). Guessing a 5-char code is impractical at scale, so
--    this preserves link-sharing without allowing bulk dumps of private decks.
create or replace function public.get_deck_by_code(deck_code text)
returns setof public.decks
language sql
security definer
set search_path = ''
stable
as $$
  select * from public.decks where short_code = deck_code limit 1;
$$;

revoke all on function public.get_deck_by_code(text) from public;
grant execute on function public.get_deck_by_code(text) to anon, authenticated;

-- 2) Replace ALL existing policies on decks with a correct, complete set.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'decks'
  loop
    execute format('drop policy %I on public.decks', pol.policyname);
  end loop;
end $$;

alter table public.decks enable row level security;

-- Read: published decks by anyone; your own decks by you.
-- (Private decks are still reachable one-at-a-time via get_deck_by_code().)
create policy "decks_select" on public.decks
  for select
  using (is_public = true or owner_id = auth.uid());

-- Insert: signed-in users only, and only as themselves.
create policy "decks_insert" on public.decks
  for insert to authenticated
  with check (owner_id = auth.uid());

-- Update: only your own rows, and you can't reassign them to someone else.
create policy "decks_update" on public.decks
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Delete: only your own rows.
create policy "decks_delete" on public.decks
  for delete to authenticated
  using (owner_id = auth.uid());
