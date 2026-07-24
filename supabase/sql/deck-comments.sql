-- ============================================================================
-- Cursed Realm — deck_comments table + RLS
-- Run this once in the Supabase Dashboard → SQL Editor.
--
-- The whole comments UI already ships in deck.html (post / reply / delete /
-- markdown-lite formatting) and archive.html (per-deck 💬 counts), but the
-- table it writes to was never created — every insert failed and the client
-- swallowed it as "Could not post comment — is the comments table set up?".
-- This is that table.
--
-- Threading is ONE level deep: top-level comments have parent_id = null,
-- replies point at a top-level comment. deck.html only offers Reply on
-- non-reply rows, and the check constraint below enforces it server-side.
-- ============================================================================

create table if not exists public.deck_comments (
  id         uuid primary key default gen_random_uuid(),
  deck_id    uuid not null references public.decks(id)        on delete cascade,
  user_id    uuid not null references auth.users(id)          on delete cascade,
  parent_id  uuid          references public.deck_comments(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint deck_comments_body_len check (char_length(btrim(body)) between 1 and 2000)
);

-- deck.html orders by created_at within a deck; archive.html tallies by deck_id.
create index if not exists deck_comments_deck_id_created_at_idx
  on public.deck_comments (deck_id, created_at);
create index if not exists deck_comments_parent_id_idx
  on public.deck_comments (parent_id);
create index if not exists deck_comments_user_id_idx
  on public.deck_comments (user_id);

-- Enforce single-level threading: a reply's parent must itself be top-level,
-- and must live on the same deck. (A trigger, because CHECK can't subquery.)
create or replace function public.deck_comments_check_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare p record;
begin
  if new.parent_id is null then return new; end if;
  select deck_id, parent_id into p from public.deck_comments where id = new.parent_id;
  if not found then
    raise exception 'parent comment does not exist';
  end if;
  if p.parent_id is not null then
    raise exception 'replies may not be nested more than one level deep';
  end if;
  if p.deck_id <> new.deck_id then
    raise exception 'reply must be on the same deck as its parent';
  end if;
  return new;
end $$;

drop trigger if exists deck_comments_parent_guard on public.deck_comments;
create trigger deck_comments_parent_guard
  before insert or update on public.deck_comments
  for each row execute function public.deck_comments_check_parent();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Replace any existing policies with a correct, complete set.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'deck_comments'
  loop
    execute format('drop policy %I on public.deck_comments', pol.policyname);
  end loop;
end $$;

alter table public.deck_comments enable row level security;

-- Read: comments on any deck you can already see. The subquery is itself
-- subject to decks_select (is_public = true or owner_id = auth.uid()), so this
-- is exactly "public decks by anyone, your own decks by you" — matching
-- deck.html, which only renders the comments block on public decks.
create policy "deck_comments_select" on public.deck_comments
  for select
  using (exists (select 1 from public.decks d where d.id = deck_id));

-- Insert: signed in, as yourself, and only on a deck that's actually public.
create policy "deck_comments_insert" on public.deck_comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.decks d where d.id = deck_id and d.is_public = true)
  );

-- Delete: your own comment, or any comment on a deck you own (moderation).
-- deck.html shows the Delete button under exactly these two conditions.
create policy "deck_comments_delete" on public.deck_comments
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = auth.uid())
  );

-- No UPDATE policy on purpose: the UI has no edit affordance, so comments are
-- append-only. Add one here if editing is ever built.

grant select on public.deck_comments to anon, authenticated;
grant insert, delete on public.deck_comments to authenticated;

-- Make PostgREST notice the new table immediately.
notify pgrst, 'reload schema';
