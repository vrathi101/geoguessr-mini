-- GeoGuessr Mini — Supabase Schema
-- Run this in the Supabase SQL editor for your project.

create table if not exists public.scores (
  id            uuid        default gen_random_uuid() primary key,
  user_id       uuid        references auth.users(id) on delete cascade not null,
  display_name  text        not null,
  avatar_url    text,
  total_score   int         not null check (total_score >= 0),
  max_possible  int         not null default 25000,
  rounds        jsonb       not null,
  timer_seconds int         not null default 0,
  difficulty    text        not null default 'world' check (difficulty in ('world','curated','urban')),
  nmpz          boolean     not null default false,
  played_at     timestamptz not null default now()
);

-- Index for leaderboard queries
create index if not exists scores_total_score_idx on public.scores (total_score desc);
create index if not exists scores_user_id_idx     on public.scores (user_id);

-- Row Level Security
alter table public.scores enable row level security;

-- Anyone can read the leaderboard
create policy "scores_public_read"
  on public.scores for select
  using (true);

-- Users can only insert their own scores
create policy "scores_user_insert"
  on public.scores for insert
  with check (auth.uid() = user_id);

-- Users cannot update or delete scores (immutable)
