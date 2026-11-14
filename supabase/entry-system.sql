-- ============================================================================
-- YNEPF entry system: database design for phases 1 to 3
--
-- DRAFT FOR REVIEW. It is not run against the live database. It builds on
-- supabase/schema.sql (competitions, editors, my_role() and friends) and is
-- written in the same upgrade-in-place style, so it is safe to run twice.
-- It is tested in a scratch database against the real schema (see
-- docs/entry-system/plan.md, "How this is tested").
--
-- Phase map (which tables each phase needs):
--   1A  take a payment      sections 0 to 7 (entries, payments, holds), 10, 11
--   1B  entries desk        add-ons, payout rules and settlement, stages, public views
--   1C  full houses         waiting list, offers, invites, OpenIPF fields, emails
--   2   lifting order       section 9
--   3   volunteers, points  section 12
--
-- Money is always whole pence (integer). Nothing here ever stores card details.
-- Personal data that only the entries team needs lives in entry_private.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Roles
--    admin       everything, including users and settings
--    entries     entries, refunds, waiting list, lifting order, money reports
--    editor      site content, and creating competitions (not their entry settings)
--    contributor news posts only
-- is_editor() keeps its old meaning ("manages site content"), so every existing
-- content table behaves exactly as before. New helper functions cover the rest.
-- WHEN THIS IS ADOPTED these definitions move into supabase/schema.sql itself. Until
-- then, re-running the old schema.sql would quietly put is_editor() back to "anyone on the list".
-- ---------------------------------------------------------------------------
-- Roles now live in supabase/schema.sql. Only the entries team's read access to competitions is added here.
drop policy if exists "entries read" on public.competitions;
create policy "entries read" on public.competitions
  for select to authenticated using (public.is_entries());

-- ---------------------------------------------------------------------------
-- 1. Who gets paid: hosts and payees
--    Every competition has a host (the federation for YNE competitions, a club or
--    university for franchise competitions). We take the entry money, keep our cut,
--    and pay the rest out after entries close. Merchandise goes 100% to the host
--    and photo packages 100% to the photographer, unless a competition says
--    otherwise.
-- ---------------------------------------------------------------------------
create table if not exists public.payees (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('federation', 'host', 'photographer')),
  contact_email text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.hosts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                              -- "Implexus Gym", "North East Strength Culture"
  kind text not null check (kind in ('federation', 'franchise', 'university')),
  payee_id uuid not null references public.payees (id),   -- who is paid the host's share
  default_cut_percent numeric(5, 2) not null default 0 check (default_cut_percent between 0 and 100),   -- our cut of ENTRY money
  created_at timestamptz not null default now()
);

alter table public.competitions add column if not exists host_id uuid references public.hosts (id);
alter table public.competitions add column if not exists host_payee_id uuid references public.payees (id);          -- who receives the host's share of entry money

-- ---------------------------------------------------------------------------
-- 2. Reference data (editable by admins, read by everyone)
-- ---------------------------------------------------------------------------
create table if not exists public.weight_classes (
  id uuid primary key default gen_random_uuid(),
  sex text not null check (sex in ('M', 'F')),
  label text not null,                                    -- "66", "120+"
  upper_kg numeric(5, 1),                                 -- null for the top "+" class
  sort_order integer not null default 0,
  min_age_category text not null default '',              -- '' = open to all; 'SJ' = sub-juniors only (men's 53, women's 43). Despite the name, it means "only this age category"
  active boolean not null default true,
  unique (sex, label)
);

create table if not exists public.divisions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                              -- "Yorkshire & North East", "North West", ...
  is_home boolean not null default false,                 -- true for our own division: not a guest
  openlifter_name text not null default '',               -- the division name as set up in the OpenLifter meet
  sort_order integer not null default 0
);

-- What sort of division each is: our own, another English division (the club list applies), another home
-- nation, or somewhere else. A lifter outside our own division is a guest.
alter table public.divisions add column if not exists kind text not null default 'english'
  check (kind in ('home', 'english', 'home_nation', 'other'));
insert into public.divisions (name, is_home, kind, sort_order) values
  ('Yorkshire & North East', true, 'home', 1),
  ('East Midlands', false, 'english', 10), ('Greater London', false, 'english', 11), ('North Midlands', false, 'english', 12),
  ('North West', false, 'english', 13), ('South East', false, 'english', 14), ('South Midlands', false, 'english', 15),
  ('South West', false, 'english', 16), ('West Midlands', false, 'english', 17),
  ('Scotland', false, 'home_nation', 30), ('Wales', false, 'home_nation', 31), ('Northern Ireland', false, 'home_nation', 32), ('Isle of Man', false, 'home_nation', 33),
  ('Other (another country)', false, 'other', 90)
on conflict (name) do update set kind = excluded.kind, is_home = excluded.is_home;

-- The English Powerlifting Association's approved (affiliated) clubs, imported every few weeks from its website (the
-- sync-clubs function). Names only: no contact details are stored.
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text generated always as (lower(btrim(name))) stored unique,
  source text not null default 'manual' check (source in ('epa_affiliated', 'bp_approved', 'manual')),
  region text not null default '',
  active boolean not null default true,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Age category from year of birth (IPF calendar-year rule). Never stored on an entry.
create or replace function public.age_category_on(dob date, on_date date)
returns text
language sql immutable
as $$
  select case
    when (extract(year from on_date) - extract(year from dob)) between 14 and 18 then 'SJ'
    when (extract(year from on_date) - extract(year from dob)) between 19 and 23 then 'J'
    when (extract(year from on_date) - extract(year from dob)) between 24 and 39 then ''     -- open
    when (extract(year from on_date) - extract(year from dob)) between 40 and 49 then 'M1'
    when (extract(year from on_date) - extract(year from dob)) between 50 and 59 then 'M2'
    when (extract(year from on_date) - extract(year from dob)) between 60 and 69 then 'M3'
    when (extract(year from on_date) - extract(year from dob)) >= 70 then 'M4'
    else 'under14'
  end
$$;
-- Exact age on the day (for the under-18 rule and the OpenLifter export).
create or replace function public.age_on(dob date, on_date date) returns integer
language sql immutable as $$ select extract(year from age(on_date, dob))::int $$;

-- ---------------------------------------------------------------------------
-- 3. Competition entry settings
-- ---------------------------------------------------------------------------
alter table public.competitions add column if not exists path_slug text not null default '';        -- "yne-march-open" (the year is added in the address)
alter table public.competitions add column if not exists entry_method text not null default 'external'
  check (entry_method in ('yne', 'external'));                                                       -- 'external' = the old entry link
alter table public.competitions add column if not exists entries_closed_manually boolean not null default false;
alter table public.competitions add column if not exists form_summary text not null default '';
alter table public.competitions add column if not exists banner_path text not null default '';
create unique index if not exists competitions_year_path_slug
  on public.competitions ((extract(year from start_date)::int), path_slug) where path_slug <> '';

-- If the address name changes after publishing, the old address keeps working.
create table if not exists public.competition_redirects (
  old_path text primary key,                              -- "/competitions/2027/yne-march"
  competition_id uuid not null references public.competitions (id) on delete cascade
);

create table if not exists public.entry_settings (
  competition_id uuid primary key references public.competitions (id) on delete cascade,
  events text[] not null default array['full_power', 'bench_only'],
  equipment text[] not null default array['classic', 'equipped'],
  entries_close_at timestamptz,
  hold_minutes integer not null default 5,
  refund_cutoff timestamptz,                              -- full automatic refund up to here
  openipf_mode text not null default 'optional' check (openipf_mode in ('required', 'optional', 'hidden')),
  qualification_mode text not null default 'none' check (qualification_mode in ('none', 'glp', 'totals')),
  qualification_glp numeric(5, 2),
  days integer not null default 1,
  sessions_per_day integer not null default 2,
  platforms integer not null default 1,
  flights_per_session integer not null default 2,
  guest_delay_days integer not null default 14 check (guest_delay_days between 0 and 90),   -- guests (outside our division) can enter this many days after entry opens
  offer_window_hours integer not null default 48,
  offer_reminder_hours integer not null default 12,
  offer_automatic boolean not null default true,          -- offer places automatically, or wait for "Offer next place"
  stripe_fee_policy text not null default 'federation' check (stripe_fee_policy in ('federation', 'pro_rata')),
  success_message_md text not null default '',
  updated_at timestamptz not null default now()
);

-- Entry stages: who can enter when. Each stage only opens if places remain.
create table if not exists public.entry_stages (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  kind text not null check (kind in ('priority', 'qualifier', 'general', 'guest')),
  name text not null,
  opens_at timestamptz not null,
  sort_order integer not null default 0
);

-- Prices: first matching rule wins, in sort order. A null column means "any".
create table if not exists public.price_rules (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  sort_order integer not null default 0,
  label text not null,                                    -- "Sub-junior, any event"
  event text check (event in ('full_power', 'bench_only')),
  age_category text,                                      -- 'SJ', 'J', 'M1' ...
  equipment text check (equipment in ('classic', 'equipped')),
  price_pence integer not null check (price_pence >= 0)
);

-- Qualifying totals per weight class and sex (for competitions that qualify on totals).
create table if not exists public.qualifying_totals (
  competition_id uuid not null references public.competitions (id) on delete cascade,
  weight_class_id uuid not null references public.weight_classes (id),
  total_kg numeric(6, 1) not null,
  primary key (competition_id, weight_class_id)
);

-- Add-ons: photo packages and merchandise.
create table if not exists public.addons (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  kind text not null check (kind in ('photo', 'merch', 'federation')),  -- decides who is paid: photo and merch by payout_rules, federation: the federation keeps it all
  name text not null,
  description text not null default '',
  price_pence integer not null check (price_pence >= 0),
  stock integer,                                          -- null = unlimited
  report_to_email text not null default '',
  size_guide_path text not null default '',
  sort_order integer not null default 0
);
alter table public.addons drop constraint if exists addons_kind_check;
alter table public.addons add constraint addons_kind_check check (kind in ('photo', 'merch', 'federation'));
create table if not exists public.addon_options (          -- e.g. T-shirt sizes
  id uuid primary key default gen_random_uuid(),
  addon_id uuid not null references public.addons (id) on delete cascade,
  label text not null,
  stock integer,
  sort_order integer not null default 0
);
create table if not exists public.addon_images (            -- up to 4 per add-on, alt text required
  id uuid primary key default gen_random_uuid(),
  addon_id uuid not null references public.addons (id) on delete cascade,
  path text not null,
  alt text not null check (char_length(alt) > 0),
  sort_order integer not null default 0
);

-- Franchise competitions are run by a host, who is paid the entry fee less the federation's fixed amount. Competitions the
-- federation runs itself are not: the federation keeps the whole entry fee (less nothing but Stripe's fees).
alter table public.competitions add column if not exists is_franchise boolean not null default true;

-- What the federation keeps from each entry: a fixed amount, 30% of the standard YNE entry prices, whatever the host charges.
-- The host receives the rest of the entry fee (before any discount). Sub-junior entries pay the sub-junior amount; bench only
-- entries the bench amount; everyone else (novice, junior, masters and open) the full power amount.
create table if not exists public.federation_fees (
  key text primary key check (key in ('full_power', 'bench_only', 'sub_junior')),
  pence integer not null check (pence >= 0)
);
insert into public.federation_fees (key, pence) values ('full_power', 1200), ('bench_only', 750), ('sub_junior', 450) on conflict (key) do nothing;

-- Each competition keeps its own copy of the amounts, taken from these defaults when it is created, so changing the defaults later
-- never changes the report for a competition that already exists. (A competition's amounts can be changed on its Money tab.)
alter table public.competitions add column if not exists fee_full_power_pence integer check (fee_full_power_pence >= 0);
alter table public.competitions add column if not exists fee_bench_only_pence integer check (fee_bench_only_pence >= 0);
alter table public.competitions add column if not exists fee_sub_junior_pence integer check (fee_sub_junior_pence >= 0);
update public.competitions set
  fee_full_power_pence = coalesce(fee_full_power_pence, (select pence from public.federation_fees where key = 'full_power'), 1200),
  fee_bench_only_pence = coalesce(fee_bench_only_pence, (select pence from public.federation_fees where key = 'bench_only'), 750),
  fee_sub_junior_pence = coalesce(fee_sub_junior_pence, (select pence from public.federation_fees where key = 'sub_junior'), 450)
  where fee_full_power_pence is null or fee_bench_only_pence is null or fee_sub_junior_pence is null;
create or replace function public.competition_fee_snapshot() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.fee_full_power_pence := coalesce(new.fee_full_power_pence, (select pence from public.federation_fees where key = 'full_power'), 1200);
  new.fee_bench_only_pence := coalesce(new.fee_bench_only_pence, (select pence from public.federation_fees where key = 'bench_only'), 750);
  new.fee_sub_junior_pence := coalesce(new.fee_sub_junior_pence, (select pence from public.federation_fees where key = 'sub_junior'), 450);
  return new;
end
$$;
drop trigger if exists competitions_fee_snapshot on public.competitions;
create trigger competitions_fee_snapshot before insert on public.competitions for each row execute function public.competition_fee_snapshot();

-- ---------------------------------------------------------------------------
-- 3b. Discount codes
--     Made in the editor, for one competition or for any competition. A code can be tied to one email address (so it
--     cannot be passed around), is case-insensitive, and can be used a set number of times. "percent" takes that
--     percentage off, "amount" takes that many pence off. A code that takes the whole price off makes a free entry.
-- ---------------------------------------------------------------------------
create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid references public.competitions (id) on delete cascade,          -- null = any competition
  code text not null,
  code_key text generated always as (upper(btrim(code))) stored unique,
  recipient_name text not null default '',
  recipient_email text not null default '' check (recipient_email = lower(recipient_email)),   -- if set, only this email can use it
  kind text not null check (kind in ('percent', 'amount')),
  value integer not null check (value > 0),                                           -- percent (1 to 100) or pence
  max_uses integer not null default 1 check (max_uses >= 1),
  expires_at timestamptz,
  active boolean not null default true,
  reason text not null default '',                                                    -- for example "Volunteer points: half price"
  created_by text not null default '',
  created_at timestamptz not null default now(),
  check ((kind = 'percent' and value <= 100) or kind = 'amount')
);

-- ---------------------------------------------------------------------------
-- 4. Entries
--    status: held (place reserved while paying), paid, comped (free), cancelled,
--    refunded. Only held entries with an unexpired hold, paid and comped entries
--    use up a place.
-- ---------------------------------------------------------------------------
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete restrict,
  status text not null default 'held' check (status in ('held', 'paid', 'comped', 'cancelled', 'refunded')),
  source text not null default 'web' check (source in ('web', 'priority', 'offer', 'manual')),
  stage_id uuid references public.entry_stages (id),
  -- About you
  email text not null check (email = lower(email)),
  full_name text not null,
  display_name text not null default '',                  -- how it appears on public lists; blank = full_name
  bp_number text not null default '',
  date_of_birth date not null,
  sex text not null check (sex in ('M', 'F')),
  division_id uuid references public.divisions (id),
  club text not null default '',
  instagram text not null default '',
  photo_ok boolean not null default false,                -- promotional photos and video
  photo_opt_out boolean not null default false,           -- goes on the do-not-photograph list
  eligibility_confirmed boolean not null default false,
  -- Your lifting
  weight_class_id uuid references public.weight_classes (id),
  equipment text check (equipment in ('classic', 'equipped')),
  event text check (event in ('full_power', 'bench_only')),
  openipf_url text not null default '',
  openipf_slug text not null default '',
  openipf_status text not null default 'pending' check (openipf_status in ('pending', 'found', 'not_found', 'error', 'skipped')),
  openipf_checked_at timestamptz,
  best_total_kg numeric(6, 1),                            -- last 12 months, filled in the background
  best_glp numeric(5, 2),
  -- Flags worked out by the system, adjustable by the entries team (with a reason in the audit log)
  is_guest boolean not null default false,
  can_break_records boolean not null default true,
  qualification text not null default 'unknown' check (qualification in ('met', 'not_met', 'unknown')),
  -- Money and timing
  price_pence integer not null default 0,
  points_used integer not null default 0,
  hold_expires_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text not null default ''
);
-- The waiting list entry this place came from (set when someone enters with an offered place).
-- (waiting_list is created further down, so the column and its link are added after it exists; see section 7.)
-- Added for the entries desk: whether the entries team has checked the membership number (for guests), and a private note.
alter table public.entries add column if not exists membership_checked boolean not null default false;
alter table public.entries add column if not exists discount_code_id uuid references public.discount_codes (id) on delete set null;
alter table public.entries add column if not exists discount_pence integer not null default 0;
-- The entry fee before any discount, which is what the host's share is worked out from (the federation absorbs discounts).
alter table public.entries add column if not exists list_price_pence integer;
alter table public.entries add column if not exists entry_note text not null default '';
create index if not exists entries_competition_status on public.entries (competition_id, status);
create index if not exists entries_email on public.entries (email);
create index if not exists entries_bp_number on public.entries (bp_number) where bp_number <> '';

-- Sensitive details, readable only by the entries team. Never exported (except the printable support
-- needs list for the day), emailed or in a public view. Guardian details are only collected, and only
-- shown, for lifters who are under 18 on the competition day.
create table if not exists public.entry_private (
  entry_id uuid primary key references public.entries (id) on delete cascade,
  guardian_name text not null default '',                 -- under 18 on the competition day
  guardian_phone text not null default '',
  guardian_email text not null default '',
  guardian_consent boolean not null default false,
  -- Access needs: every lifter is asked. Stored so the entries team can help on the day.
  access_hearing boolean not null default false,          -- "hard of hearing: needs hand signals or clear commands"
  access_sight boolean not null default false,            -- "hard of seeing: may need assistance"
  access_notes text not null default '',                  -- anything else
  access_consent boolean not null default false,          -- ticked when they have entered anything: "I agree you can store this so you can help me on the day"
  eligibility_note text not null default '',               -- kept only in case the committee wants the box; the plan starts without it
  delete_after date                                        -- when this row is removed automatically (see plan, privacy)
);

-- Whether the lifter says they have access needs. No details are collected on the form: the entries team follows up
-- by email, so health information is not stored here.
alter table public.entry_private add column if not exists access_needs boolean not null default false;

create table if not exists public.entry_addons (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  addon_id uuid not null references public.addons (id),
  option_id uuid references public.addon_options (id),
  quantity integer not null default 1 check (quantity > 0),
  price_pence integer not null check (price_pence >= 0)
);

-- ---------------------------------------------------------------------------
-- 5. Payments (Stripe holds the card data; we hold ids and amounts)
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete restrict,
  stripe_session_id text not null unique,
  stripe_payment_intent text unique,
  amount_pence integer not null check (amount_pence >= 0),
  stripe_fee_pence integer not null default 0,            -- Stripe keeps this even if we refund
  card_brand text not null default '',
  card_last4 text not null default '',
  receipt_url text not null default '',
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'expired')),
  created_at timestamptz not null default now()
);
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  stripe_refund_id text unique,                            -- null until Stripe confirms
  amount_pence integer not null check (amount_pence > 0),
  reason text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
-- Every Stripe event we receive, so a repeated delivery is ignored.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 6. Places left (what the entry button and the live count use)
--    Held entries use a place only until their hold runs out.
-- ---------------------------------------------------------------------------
create or replace function public.places_taken(c uuid) returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.entries
  where competition_id = c
    and (status in ('paid', 'comped') or (status = 'held' and hold_expires_at > now()))
$$;
create or replace function public.places_left(c uuid) returns integer
language sql stable security definer set search_path = public
as $$
  select greatest(coalesce((select capacity from public.competitions where id = c), 0) - public.places_taken(c), 0)
$$;
grant execute on function public.places_left(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Waiting list, offers and priority links
-- ---------------------------------------------------------------------------
create table if not exists public.waiting_list (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  email text not null check (email = lower(email)),
  full_name text not null,
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'entered', 'declined', 'lapsed', 'removed')),
  joined_at timestamptz not null default now(),
  unique (competition_id, email)
);
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  waiting_id uuid not null references public.waiting_list (id) on delete cascade,
  token_hash text not null unique,                        -- the emailed token is never stored, only its hash
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reminder_sent_at timestamptz,
  outcome text check (outcome in ('entered', 'declined', 'lapsed'))
);
alter table public.entry_settings alter column hold_minutes set default 5;
alter table public.entry_settings add column if not exists guest_delay_days integer not null default 14 check (guest_delay_days between 0 and 90);   -- short holds are fairer: places are not parked

create table if not exists public.invites (                -- priority entry (phase 3) and manual personal links
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  email text not null check (email = lower(email)),
  token_hash text not null unique,
  stage_id uuid references public.entry_stages (id),
  expires_at timestamptz,
  used_at timestamptz,
  entry_id uuid references public.entries (id) on delete set null          -- the entry started with this link
);
alter table public.entries add column if not exists waiting_id uuid references public.waiting_list (id) on delete set null;

-- A place offered to someone on the waiting list is theirs for the offer window, so it counts as taken.
-- It stops counting once they have a live entry (that entry counts instead), or the offer ends.
create or replace function public.places_taken(c uuid) returns integer
language sql stable security definer set search_path = public
as $$
  select (select count(*)::int from public.entries
           where competition_id = c and (status in ('paid', 'comped') or (status = 'held' and hold_expires_at > now())))
       + (select count(*)::int from public.offers o join public.waiting_list w on w.id = o.waiting_id
           where w.competition_id = c and o.outcome is null and o.expires_at > now()
             and not exists (select 1 from public.entries e where e.waiting_id = w.id
                               and (e.status in ('paid', 'comped') or (e.status = 'held' and e.hold_expires_at > now()))))
$$;

alter table public.invites add column if not exists entry_id uuid references public.entries (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 8. Emails: the wording (federation default, per-competition override) and a log
-- ---------------------------------------------------------------------------
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid references public.competitions (id) on delete cascade,   -- null = the federation default
  kind text not null check (kind in ('entry_confirmed', 'entry_copy', 'waiting_joined', 'offer', 'offer_reminder',
    'offer_expired', 'entry_cancelled', 'lifting_order', 'priority_entry')),
  subject text not null,
  body_md text not null,
  unique nulls not distinct (competition_id, kind)
);
create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  to_email text not null,
  entry_id uuid references public.entries (id) on delete set null,
  waiting_id uuid references public.waiting_list (id) on delete set null,
  provider_id text not null default '',                   -- Resend's id for the message
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text not null default '',
  sent_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 9. Lifting order (phase 2)
-- ---------------------------------------------------------------------------
create table if not exists public.lifting_orders (
  competition_id uuid primary key references public.competitions (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_as text check (published_as in ('provisional', 'final')),
  published_at timestamptz,
  prime_time_enabled boolean not null default false,       -- the top lifters by GL points in their own session(s)
  prime_time_men integer not null default 14,              -- one prime time session, two flights: the top 14 men and the top 14 women by best GL
  prime_time_women integer not null default 14,
  max_full_power_per_flight integer not null default 14,
  max_per_flight integer not null default 20
);
create table if not exists public.lo_sessions (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  day integer not null,
  session_no integer not null,
  platform integer not null default 1,
  name text not null default '',                           -- e.g. "Prime Time"
  is_prime_time boolean not null default false,
  weigh_in_at timestamptz,
  lift_off_at timestamptz,
  awards_at timestamptz,
  unique (competition_id, day, session_no, platform)
);
create table if not exists public.lo_flights (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.lo_sessions (id) on delete cascade,
  letter text not null,                                    -- runs on across the whole competition: A, B, C ...
  locked boolean not null default false
);
create table if not exists public.lo_assignments (
  entry_id uuid primary key references public.entries (id) on delete cascade,
  flight_id uuid not null references public.lo_flights (id) on delete cascade,
  position integer not null default 0,
  locked boolean not null default false,
  lot_number integer,
  reason text not null default ''                          -- why the auto sort put them here
);

-- ---------------------------------------------------------------------------
-- 10. Audit log: who did what and when, with before and after. Append only.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text not null default 'system',
  table_name text not null,
  row_id text not null default '',
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb
);
create index if not exists audit_log_row on public.audit_log (table_name, row_id, at desc);

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public, auth
as $$
declare who text := 'system'; rid text;
begin
  if auth.uid() is not null then
    select coalesce(u.email, 'unknown') into who from auth.users u where u.id = auth.uid();
  end if;
  rid := coalesce((to_jsonb(coalesce(new, old))->>'id'), (to_jsonb(coalesce(new, old))->>'entry_id'), '');
  -- Guardian details are kept for 30 days after the competition but the audit log is kept for years, so for that table
  -- the log records that something changed (and who by), never the details themselves.
  insert into public.audit_log (actor_id, actor_email, table_name, row_id, action, before, after)
  values (auth.uid(), coalesce(who, 'system'), tg_table_name, rid, lower(tg_op),
          case when tg_op <> 'INSERT' then case when tg_table_name = 'entry_private' then '{"redacted": "personal details"}'::jsonb else to_jsonb(old) end end,
          case when tg_op <> 'DELETE' then case when tg_table_name = 'entry_private' then '{"redacted": "personal details"}'::jsonb else to_jsonb(new) end end);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['entries', 'entry_private', 'entry_addons', 'payments', 'refunds', 'entry_settings', 'entry_stages',
                           'price_rules', 'addons', 'waiting_list', 'offers', 'invites', 'lifting_orders', 'lo_sessions',
                           'lo_flights', 'lo_assignments', 'editors', 'discount_codes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Money: who is owed what once entries close
--     payout_rules say, for each kind of money, who receives what percentage.
--     competition_settlement() turns the paid entries into "money to send".
-- ---------------------------------------------------------------------------
create table if not exists public.payout_rules (
  competition_id uuid not null references public.competitions (id) on delete cascade,
  category text not null check (category in ('entry', 'merch', 'photo')),
  payee_id uuid not null references public.payees (id),
  percent numeric(5, 2) not null check (percent between 0 and 100),
  primary key (competition_id, category, payee_id)
);
create table if not exists public.payouts (                -- a record that we have sent the money
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete restrict,
  payee_id uuid not null references public.payees (id),
  amount_pence integer not null check (amount_pence > 0),
  paid_on date not null,
  reference text not null default '',
  created_by text not null default ''
);

-- One row per payee: what they are owed, split by kind of money, less their share of Stripe fees.
-- Refunded and cancelled entries are left out of the takings, but Stripe keeps its fee on them,
-- so every fee still counts. The rows add up: sum(net) = takings - fees, provided each kind of money's
-- percentages total 100 and the federation has a rule row (0% is fine) to receive any leftover fee pence.
create or replace function public.competition_settlement(c uuid)
returns table (payee_id uuid, payee_name text, payee_kind text, entry_pence bigint, merch_pence bigint, photo_pence bigint,
               gross_pence bigint, fee_pence bigint, net_pence bigint)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  fees bigint; fed uuid; host uuid; start date; f_full integer; f_bench integer; f_sj integer;
begin
  -- Who is owed what is for the entries team only. (This function reads past the row level rules, so it checks for itself.)
  if not public.is_entries() then raise exception 'forbidden'; end if;
  select coalesce(sum(p.stripe_fee_pence), 0) into fees
    from public.payments p join public.entries e on e.id = p.entry_id
   where e.competition_id = c and p.status = 'succeeded';
  select py.id into fed from public.payees py where py.kind = 'federation' limit 1;
  select case when k.is_franchise then k.host_payee_id end, k.start_date, coalesce(k.fee_full_power_pence, 1200), coalesce(k.fee_bench_only_pence, 750), coalesce(k.fee_sub_junior_pence, 450)
    into host, start, f_full, f_bench, f_sj from public.competitions k where k.id = c;

  return query
  with live as (
    select e.id, e.price_pence, e.discount_pence, e.list_price_pence, e.event, e.date_of_birth,
           coalesce((select sum(ea.price_pence) from public.entry_addons ea where ea.entry_id = e.id), 0) as addons
      from public.entries e where e.competition_id = c and e.status in ('paid', 'comped')
  ),
  -- Entry money. cash is what the lifter actually paid for the entry; list is the entry fee before any discount. The federation
  -- keeps its fixed amount (never more than the fee), the host is paid the rest of the full fee, and the federation absorbs any
  -- discount: its share is whatever is left of the cash after the host has been paid (negative for a discounted entry).
  per_entry as (
    select l.id, l.price_pence - l.addons as cash,
           coalesce(l.list_price_pence, l.price_pence - l.addons + l.discount_pence) as list,
           case when l.event = 'bench_only' then f_bench when public.age_category_on(l.date_of_birth, start) = 'SJ' then f_sj else f_full end as std_fee
      from live l
  ),
  entry_parts as (
    select pe.id, pe.cash, case when host is null then 0 else pe.list - least(pe.list, pe.std_fee) end as host_pence from per_entry pe
  ),
  entry_rows as (
    select host as payee_id, coalesce(sum(ep.host_pence), 0)::bigint as pence from entry_parts ep where host is not null
    union all
    select fed, (coalesce(sum(ep.cash), 0) - coalesce(sum(ep.host_pence), 0))::bigint from entry_parts ep
  ),
  -- Merchandise and photo packages are shared by percentages set for the competition.
  money as (
    select a.kind as category, coalesce(sum(ea.price_pence), 0) as pence
      from (values ('merch'), ('photo')) as a(kind)
      left join public.addons ad on ad.competition_id = c and ad.kind = a.kind
      left join public.entry_addons ea on ea.addon_id = ad.id and ea.entry_id in (select id from live)
     group by a.kind
  ),
  raw as (
    select r.payee_id, m.category, r.percent, m.pence as category_pence, round(m.pence * r.percent / 100.0)::bigint as pence
      from money m join public.payout_rules r on r.competition_id = c and r.category = m.category
  ),
  -- Rounding each share can leave a penny over or short. When a category's shares add up to 100%, the difference goes to
  -- the payee with the biggest share, so the category always adds up exactly.
  split as (
    select payee_id, category,
           pence + case when sum(percent) over (partition by category) = 100
                         and row_number() over (partition by category order by percent desc, payee_id) = 1
                        then category_pence - sum(pence) over (partition by category) else 0 end as pence
      from raw
  ),
  -- Extras marked "paid to the federation" are the federation's own: all of it, no percentages.
  fed_extras as (
    select fed as payee_id, 'merch'::text as category, coalesce(sum(ea.price_pence), 0)::bigint as pence
      from public.addons ad join public.entry_addons ea on ea.addon_id = ad.id and ea.entry_id in (select id from live)
     where ad.competition_id = c and ad.kind = 'federation' having coalesce(sum(ea.price_pence), 0) > 0
  ),
  parts as (
    select er.payee_id, 'entry'::text as category, er.pence from entry_rows er
    union all select s.payee_id, s.category, s.pence from split s
    union all select fe.payee_id, fe.category, fe.pence from fed_extras fe
  ),
  per_payee as (
    select pt.payee_id,
           sum(case when pt.category = 'entry' then pt.pence else 0 end)::bigint as entry_pence,
           sum(case when pt.category = 'merch' then pt.pence else 0 end)::bigint as merch_pence,
           sum(case when pt.category = 'photo' then pt.pence else 0 end)::bigint as photo_pence,
           sum(pt.pence)::bigint as gross_pence
      from parts pt group by pt.payee_id
  )
  -- Stripe's fees (on every payment, refunded ones too) are all paid by the federation.
  select pp.payee_id, py.name, py.kind, pp.entry_pence, pp.merch_pence, pp.photo_pence, pp.gross_pence,
         (case when pp.payee_id = fed then fees else 0 end)::bigint,
         (pp.gross_pence - case when pp.payee_id = fed then fees else 0 end)::bigint
    from per_payee pp join public.payees py on py.id = pp.payee_id
   order by (py.kind = 'federation'), py.name;
end;
$$;
revoke all on function public.competition_settlement(uuid) from public, anon;
grant execute on function public.competition_settlement(uuid) to authenticated;   -- and the function itself checks the caller is on the entries team

-- ---------------------------------------------------------------------------
-- 12. Volunteers, points and priority entry (phase 3)
-- ---------------------------------------------------------------------------
create table if not exists public.volunteer_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                              -- "Loader", "Referee", "Set up and take down" ...
  points integer not null default 0,
  sort_order integer not null default 0
);
create table if not exists public.rota_slots (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  role_id uuid not null references public.volunteer_roles (id),
  day integer not null default 1,
  starts_at timestamptz,
  ends_at timestamptz,
  places integer not null default 1
);
create table if not exists public.rota_signups (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.rota_slots (id) on delete cascade,
  email text not null check (email = lower(email)),
  full_name text not null,
  status text not null default 'signed_up' check (status in ('signed_up', 'done', 'no_show', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (slot_id, email)
);
-- Append only. A balance is the sum of unexpired rows; spending uses the oldest first.
create table if not exists public.points_ledger (
  id bigint generated always as identity primary key,
  email text not null check (email = lower(email)),
  delta integer not null,                                  -- positive earned, negative spent
  reason text not null,
  signup_id uuid references public.rota_signups (id),
  entry_id uuid references public.entries (id),
  earned_at timestamptz not null default now(),
  expires_at timestamptz                                   -- 24 months after earning, for earned rows
);
create index if not exists points_ledger_email on public.points_ledger (email);

-- ---------------------------------------------------------------------------
-- 13. Public views: only what the website is allowed to show
-- ---------------------------------------------------------------------------
-- The entries list (shown before a lifting order is published): no emails, no private flags.
create or replace view public.entries_public as
select e.id, e.competition_id,
       coalesce(nullif(e.display_name, ''), e.full_name) as name,
       e.club, wc.label as weight_class, e.sex,
       public.age_category_on(e.date_of_birth, c.start_date) as age_category,
       e.event, e.equipment, e.instagram, e.openipf_url, e.best_total_kg, e.paid_at, e.is_guest
from public.entries e
join public.competitions c on c.id = e.competition_id
left join public.weight_classes wc on wc.id = e.weight_class_id
where e.status in ('paid', 'comped');

-- The waiting list: name and position only.
create or replace view public.waiting_list_public as
select w.competition_id, w.full_name as name,
       row_number() over (partition by w.competition_id order by w.joined_at)::int as position
from public.waiting_list w
where w.status in ('waiting', 'offered');

-- The public calendar view again, now with the waiting list switching on by itself: for online entry, "full" is simply
-- "no places left". Everything else is as in schema.sql.
drop view if exists public.competitions_public;
create view public.competitions_public as
select
  k.id, k.name, k.description, k.label, k.kind, k.start_date, k.end_date, k.start_time, k.end_time,
  k.venue_name, k.venue_address, k.map_url, k.capacity,
  k.entry_opens, k.entry_closes, (k.entries_full or k.auto_full) as entries_full,
  case
    when not (k.entries_full or k.auto_full)
     and not k.entries_closed_manually
     and (k.entry_opens is null or k.entry_opens <= now())
     and (k.entry_closes is null or k.entry_closes > now())
    then case when k.entry_method = 'yne' and k.slug <> '' then '/enter?c=' || k.slug
              when k.entry_method = 'external' then k.entry_url
              else '' end
    else ''
  end as entry_url,
  k.entry_method,
  case when k.entry_method = 'yne' and k.auto_full and k.slug <> '' then '/enter?c=' || k.slug else '' end as waitlist_url,
  k.lifting_order_url,
  k.openipf_url,
  k.slug
from (
  select c.*, (c.entry_method = 'yne' and not c.entries_closed_manually and (c.entry_opens is null or c.entry_opens <= now())
               and (c.entry_closes is null or c.entry_closes > now()) and public.places_left(c.id) < 1) as auto_full
    from public.competitions c where c.published
) k;
grant select on public.competitions_public to anon, authenticated;

-- The state of entry for a competition card or page.
drop view if exists public.competition_entry_state;
create view public.competition_entry_state as
select c.id as competition_id, c.capacity, public.places_left(c.id) as places_left,
       c.entry_method, c.entries_closed_manually, c.entry_opens, c.entry_closes
from public.competitions c
left join public.entry_settings es on es.competition_id = c.id
where c.published;

-- ---------------------------------------------------------------------------
-- 14. Row level security
--     Rule of thumb: nothing about people is readable by the public except
--     through the views above. The entries team (and admins) see everything to
--     do with entries. Admins alone change roles and the people lists.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  -- Settings that the public competition page needs to read: public read, admins and the entries team write.
  foreach t in array array['entry_settings', 'entry_stages', 'price_rules', 'addons', 'addon_options', 'addon_images',
                           'qualifying_totals', 'weight_classes', 'divisions', 'clubs', 'volunteer_roles'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('drop policy if exists "entries write" on public.%I', t);
    execute format('create policy "entries write" on public.%I for all to authenticated using (public.is_entries()) with check (public.is_entries())', t);
  end loop;
  -- Everything about people and money: the entries team only (admins included).
  -- payees and hosts are here because they hold contact emails and our commercial split.
  foreach t in array array['federation_fees', 'discount_codes', 'payees', 'hosts', 'entries', 'entry_private', 'entry_addons', 'payments', 'refunds', 'stripe_events', 'waiting_list', 'offers',
                           'invites', 'email_log', 'payout_rules', 'payouts', 'lifting_orders', 'lo_sessions', 'lo_flights',
                           'lo_assignments', 'competition_redirects', 'rota_slots', 'rota_signups', 'points_ledger'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "entries team" on public.%I', t);
    execute format('create policy "entries team" on public.%I for all to authenticated using (public.is_entries()) with check (public.is_entries())', t);
  end loop;
end $$;
-- A published lifting order is public (the page reads these three).
drop policy if exists "public read published" on public.lifting_orders;
create policy "public read published" on public.lifting_orders for select to anon, authenticated using (status = 'published');
drop policy if exists "public read published" on public.lo_sessions;
create policy "public read published" on public.lo_sessions for select to anon, authenticated
  using (exists (select 1 from public.lifting_orders l where l.competition_id = lo_sessions.competition_id and l.status = 'published'));
-- The rota is public so people can sign up; sign-ups themselves go through a function, not directly.
drop policy if exists "public read" on public.rota_slots;
create policy "public read" on public.rota_slots for select to anon, authenticated using (true);
-- Email wording: the entries team writes it; nobody else needs to read it.
alter table public.email_templates enable row level security;
drop policy if exists "entries team" on public.email_templates;
create policy "entries team" on public.email_templates for all to authenticated using (public.is_entries()) with check (public.is_entries());
-- Audit log: readable by the entries team, written only by the trigger. No update or delete is possible.
alter table public.audit_log enable row level security;
drop policy if exists "entries read" on public.audit_log;
create policy "entries read" on public.audit_log for select to authenticated using (public.is_entries());

-- ---------------------------------------------------------------------------
-- 15. Grants
-- ---------------------------------------------------------------------------
grant select on public.clubs, public.entry_settings, public.entry_stages, public.price_rules, public.addons, public.addon_options,
                public.addon_images, public.qualifying_totals, public.weight_classes, public.divisions, public.payees,
                public.hosts, public.volunteer_roles, public.rota_slots, public.lifting_orders, public.lo_sessions to anon;
grant select on public.entries_public, public.waiting_list_public, public.competition_entry_state to anon, authenticated;
grant select, insert, update, delete on
  public.entry_settings, public.entry_stages, public.price_rules, public.addons, public.addon_options, public.addon_images,
  public.qualifying_totals, public.weight_classes, public.divisions, public.payees, public.hosts, public.volunteer_roles,
  public.federation_fees, public.discount_codes, public.entries, public.entry_private, public.entry_addons, public.payments, public.refunds, public.stripe_events,
  public.waiting_list, public.offers, public.invites, public.email_templates, public.email_log, public.payout_rules,
  public.payouts, public.lifting_orders, public.lo_sessions, public.lo_flights, public.lo_assignments,
  public.competition_redirects, public.rota_slots, public.rota_signups, public.points_ledger
  to authenticated;
grant select on public.audit_log to authenticated;
-- The audit log and points ledger are append only: nobody gets update or delete on them.
revoke update, delete on public.audit_log, public.points_ledger from authenticated;

-- ---------------------------------------------------------------------------
-- 16. Starting an entry (phase 1A)
--     Called only by the payment function (service role), never by the browser.
--     In one step it checks the rules, works out the price and holds a place, so two
--     people can never take the last place. Errors carry a short code the form turns
--     into plain words: closed, not_open, full, already_entered, invalid:<what>, no_price.
-- ---------------------------------------------------------------------------
create or replace function public.start_entry(p jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.competitions%rowtype;
  s public.entry_settings%rowtype;
  v_email text := lower(trim(coalesce(p->>'email', '')));
  v_name text := trim(coalesce(p->>'full_name', ''));
  v_dob date;
  v_sex text := p->>'sex';
  v_event text := p->>'event';
  v_equip text := p->>'equipment';
  v_class uuid := nullif(p->>'weight_class_id', '')::uuid;
  v_stage uuid;
  v_price integer;
  v_cat text;
  v_age integer;
  v_entry uuid;
  v_expires timestamptz;
  v_access boolean;
  v_invite uuid;
  v_bp text := lower(trim(coalesce(p->>'bp_number', '')));
  v_d public.divisions%rowtype;
  v_guest boolean;
  v_club text;
  v_disc jsonb;
  v_code_id uuid;
  v_discount integer := 0;
  v_free boolean := false;
  v_extras integer := 0;
  v_lines jsonb := '[]'::jsonb;
  v_x jsonb;
  v_ad public.addons%rowtype;
  v_opt public.addon_options%rowtype;
  v_seen uuid[] := '{}';
  v_entry_price integer;
  v_offer uuid;
  v_wait uuid;
begin
  -- "TBC" and the like are accepted when someone does not have their number yet; they are not a number to compare.
  if v_bp ~ '^(tbc|tbd|n/?a|none|unknown|pending|\?+|-+|x+|0+)$' then v_bp := ''; end if;
  select * into c from public.competitions where id = (p->>'competition_id')::uuid for update;   -- one at a time per competition
  if not found or c.entry_method <> 'yne' then raise exception 'closed'; end if;
  -- Unpublished (test) competitions can only be entered by the entries team, previewing: the payment function
  -- sets allow_unpublished after checking the caller's login. It is never taken from the browser.
  if not c.published and not coalesce((p->>'allow_unpublished')::boolean, false) then raise exception 'closed'; end if;
  select * into s from public.entry_settings where competition_id = c.id;
  if not found then raise exception 'closed'; end if;
  -- Places, opening and closing are set once, on the competition (Calendar).
  if c.entries_closed_manually or coalesce(c.entry_closes, 'infinity') <= now() then raise exception 'closed'; end if;
  if c.entry_opens is not null and c.entry_opens > now() then
    -- Priority entry opens one day before general entry, for people with a personal link made for their email.
    if c.entry_opens - interval '1 day' <= now() and coalesce(p->>'invite', '') <> '' then
      select i.id into v_invite from public.invites i
        where i.competition_id = c.id and i.email = v_email and i.used_at is null and (i.expires_at is null or i.expires_at > now())
          and i.token_hash = encode(sha256(convert_to(p->>'invite', 'UTF8')), 'hex');
      if v_invite is null then
        if exists (select 1 from public.entries where competition_id = c.id and email = v_email and status in ('paid', 'comped')) then raise exception 'already_entered'; end if;
        raise exception 'not_open';
      end if;
    else
      raise exception 'not_open';
    end if;
  end if;
  select id into v_stage from public.entry_stages
    where competition_id = c.id and kind = 'general' order by opens_at desc limit 1;     -- null unless stages are used (later phases)

  -- The person
  if v_name = '' then raise exception 'invalid:full_name'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email'; end if;
  begin v_dob := (p->>'date_of_birth')::date; exception when others then raise exception 'invalid:date_of_birth'; end;
  if v_dob is null or v_dob > c.start_date or v_dob < date '1900-01-01' then raise exception 'invalid:date_of_birth'; end if;
  v_age := public.age_on(v_dob, c.start_date);
  -- Age category and the minimum age go by the calendar year (the year they turn the age); only the under-18 guardian rule uses the exact age on the day.
  if public.age_category_on(v_dob, c.start_date) = 'under14' then raise exception 'invalid:too_young'; end if;
  if v_sex not in ('M', 'F') then raise exception 'invalid:sex'; end if;
  if not (v_event = any (s.events)) then raise exception 'invalid:event'; end if;
  if not (v_equip = any (s.equipment)) then raise exception 'invalid:equipment'; end if;
  if s.openipf_mode = 'required' and coalesce(p->>'openipf_url', '') !~* '^https://(www\.)?openipf\.org/.+' then raise exception 'invalid:openipf'; end if;
  if v_class is null or not exists (select 1 from public.weight_classes w where w.id = v_class and w.sex = v_sex and w.active
      and (w.min_age_category = '' or w.min_age_category = public.age_category_on(v_dob, c.start_date))) then
    raise exception 'invalid:weight_class';
  end if;

  -- The federation they belong to, and their club. Anyone outside our own division is a guest, and guests can only
  -- enter some days after entry opens. (The entries team checks the membership number by hand afterwards.)
  select * into v_d from public.divisions where id = nullif(p->>'division_id', '')::uuid;
  if not found then raise exception 'invalid:division'; end if;
  v_guest := not v_d.is_home;
  if v_guest and c.entry_opens is not null and now() < c.entry_opens + make_interval(days => s.guest_delay_days) then raise exception 'guest_not_open'; end if;
  -- Club: optional, and only ever one from the EPA list (so it is stored exactly as the list spells it).
  v_club := btrim(coalesce(p->>'club', ''));
  if lower(v_club) = 'unattached' then v_club := ''; end if;
  if v_club <> '' then
    select name into v_club from public.clubs where name_key = lower(v_club) and active;
    if not found then raise exception 'invalid:club'; end if;
  end if;

  -- Under 18 on the day: a named parent or guardian and their consent are required. Adults are never asked.
  if v_age < 18 and (coalesce(trim(p->>'guardian_name'), '') = '' or coalesce(trim(p->>'guardian_phone'), '') = ''
       or coalesce(trim(p->>'guardian_email'), '') = '' or not coalesce((p->>'guardian_consent')::boolean, false)) then
    raise exception 'invalid:guardian';
  end if;
  v_access := coalesce((p->>'access_needs')::boolean, false);

  -- Not already in. A lifter who comes back mid-payment simply replaces their earlier hold.
  if exists (select 1 from public.entries where competition_id = c.id and email = v_email and status in ('paid', 'comped')) then
    raise exception 'already_entered';
  end if;
  -- One lifter, one place: the same membership number cannot take a second place under another email.
  if v_bp <> '' and exists (select 1 from public.entries where competition_id = c.id and status in ('paid', 'comped') and lower(bp_number) = v_bp) then
    raise exception 'duplicate_bp';
  end if;
  update public.entries set status = 'cancelled', cancelled_at = now(), cancel_reason = 'replaced by a new attempt'
    where competition_id = c.id and status = 'held' and (email = v_email or (v_bp <> '' and lower(bp_number) = v_bp));

  -- Someone with a place offered from the waiting list (a personal link made for their email) may take it even though the
  -- competition is full: the place is being held for them.
  if btrim(coalesce(p->>'offer', '')) <> '' then
    select o.id, w.id into v_offer, v_wait from public.offers o join public.waiting_list w on w.id = o.waiting_id
      where w.competition_id = c.id and w.email = v_email and o.outcome is null and o.expires_at > now()
        and o.token_hash = encode(sha256(convert_to(btrim(p->>'offer'), 'UTF8')), 'hex');
  end if;
  if v_offer is null and public.places_left(c.id) < 1 then raise exception 'full'; end if;

  -- Price: first matching rule wins.
  v_cat := public.age_category_on(v_dob, c.start_date);
  select r.price_pence into v_price from public.price_rules r
    where r.competition_id = c.id
      and (r.event is null or r.event = v_event)
      and (r.equipment is null or r.equipment = v_equip)
      and (r.age_category is null or r.age_category = v_cat)
    order by r.sort_order, r.label limit 1;
  -- A price of nothing is never accepted here: online entry always takes a payment. (Free places are added by the entries team.)
  if v_price is null or v_price < 1 then raise exception 'no_price'; end if;

  -- A discount code, if one was given. A code that takes the whole price off makes this a free entry.
  if btrim(coalesce(p->>'discount_code', '')) <> '' then
    v_disc := public.discount_apply(p->>'discount_code', c.id, v_email, v_price);
    if not (v_disc->>'ok')::boolean then raise exception 'discount_%', v_disc->>'error'; end if;
    v_code_id := (v_disc->>'id')::uuid; v_discount := (v_disc->>'discount_pence')::int; v_price := (v_disc->>'price_pence')::int;
  end if;
  v_entry_price := v_price;

  -- Extras (a photo package, merchandise): each one must belong to this competition, be in stock, and have a size if it has sizes.
  -- Extras are not discounted. The entry's price_pence is the total the lifter pays: entry fee plus extras.
  if jsonb_typeof(p->'extras') = 'array' then
    if jsonb_array_length(p->'extras') > 10 then raise exception 'invalid:extras'; end if;
    for v_x in select * from jsonb_array_elements(p->'extras') loop
      begin select * into v_ad from public.addons where id = (v_x->>'id')::uuid and competition_id = c.id;
      exception when others then raise exception 'invalid:extras'; end;
      if not found or v_ad.id = any (v_seen) then raise exception 'invalid:extras'; end if;
      v_seen := v_seen || v_ad.id;
      v_opt := null;
      if exists (select 1 from public.addon_options o where o.addon_id = v_ad.id) then
        select * into v_opt from public.addon_options o where o.addon_id = v_ad.id and o.id = nullif(v_x->>'option_id', '')::uuid;
        if v_opt.id is null then raise exception 'invalid:extras'; end if;
      elsif coalesce(v_x->>'option_id', '') <> '' then raise exception 'invalid:extras'; end if;
      if v_ad.stock is not null and (select coalesce(sum(ea.quantity), 0) from public.entry_addons ea join public.entries e on e.id = ea.entry_id
           where ea.addon_id = v_ad.id and (e.status in ('paid', 'comped') or (e.status = 'held' and e.hold_expires_at > now()))) >= v_ad.stock then raise exception 'sold_out'; end if;
      if v_opt.id is not null and v_opt.stock is not null and (select coalesce(sum(ea.quantity), 0) from public.entry_addons ea join public.entries e on e.id = ea.entry_id
           where ea.option_id = v_opt.id and (e.status in ('paid', 'comped') or (e.status = 'held' and e.hold_expires_at > now()))) >= v_opt.stock then raise exception 'sold_out'; end if;
      v_extras := v_extras + v_ad.price_pence;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('addon_id', v_ad.id, 'option_id', v_opt.id, 'price', v_ad.price_pence));
    end loop;
  end if;
  v_price := v_entry_price + v_extras;
  v_free := v_price = 0;

  v_expires := now() + make_interval(mins => s.hold_minutes);
  insert into public.entries (competition_id, status, source, stage_id, email, full_name, display_name, bp_number, date_of_birth, sex,
      division_id, club, instagram, photo_ok, photo_opt_out, eligibility_confirmed, weight_class_id, equipment, event,
      openipf_url, price_pence, hold_expires_at, is_guest, paid_at, discount_code_id, discount_pence, list_price_pence)
    values (c.id, case when v_free then 'comped' else 'held' end, case when v_offer is not null then 'offer' else 'web' end, v_stage, v_email, v_name, trim(coalesce(p->>'display_name', '')), trim(coalesce(p->>'bp_number', '')), v_dob, v_sex,
      v_d.id, v_club, trim(coalesce(p->>'instagram', '')),
      coalesce((p->>'photo_ok')::boolean, false), coalesce((p->>'photo_opt_out')::boolean, false), coalesce((p->>'eligibility_confirmed')::boolean, false), v_class, v_equip, v_event,
      trim(coalesce(p->>'openipf_url', '')), v_price, case when v_free then null else v_expires end, v_guest, case when v_free then now() end, v_code_id, v_discount, v_entry_price + v_discount)
    returning id into v_entry;
  if v_wait is not null then update public.entries set waiting_id = v_wait where id = v_entry; end if;
  for v_x in select * from jsonb_array_elements(v_lines) loop
    insert into public.entry_addons (entry_id, addon_id, option_id, quantity, price_pence)
      values (v_entry, (v_x->>'addon_id')::uuid, nullif(v_x->>'option_id', '')::uuid, 1, (v_x->>'price')::int);
  end loop;
  insert into public.entry_private (entry_id, guardian_name, guardian_phone, guardian_email, guardian_consent, access_needs, delete_after)
    values (v_entry,
      case when v_age < 18 then trim(p->>'guardian_name') else '' end, case when v_age < 18 then trim(p->>'guardian_phone') else '' end,
      case when v_age < 18 then trim(p->>'guardian_email') else '' end, v_age < 18, v_access, coalesce(c.end_date, c.start_date) + 30);
  if v_invite is not null then update public.invites set entry_id = v_entry where id = v_invite; end if;
  return jsonb_build_object('entry_id', v_entry, 'price_pence', v_price, 'hold_expires_at', v_expires, 'competition', c.name, 'slug', c.slug, 'free', v_free, 'discount_pence', v_discount, 'extras_pence', v_extras);
end
$$;
revoke all on function public.start_entry(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.start_entry(jsonb) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The waiting list (automatic). When a competition is full, people join (name and email). When a place frees up (a
-- cancellation, a refund, a hold that ran out, more places added) the person who has waited longest is offered it for
-- the offer window (48 hours by default) through a personal link. If they do not take it, it passes to the next.
-- The functions below do the bookkeeping; the waitlist Edge Function sends the emails and runs them on a timer.
-- All of them are for the service role only, except waitlist_remove (entries team).
-- ---------------------------------------------------------------------------
create or replace function public.waitlist_join(p jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.competitions%rowtype;
  v_email text := lower(trim(coalesce(p->>'email', '')));
  v_name text := trim(coalesce(p->>'full_name', ''));
  w public.waiting_list%rowtype;
  v_pos integer;
  v_already boolean := false;
begin
  select * into c from public.competitions where id = (p->>'competition_id')::uuid;
  if not found or c.entry_method <> 'yne' then raise exception 'closed'; end if;
  if not c.published and not coalesce((p->>'allow_unpublished')::boolean, false) then raise exception 'closed'; end if;
  if c.entries_closed_manually or coalesce(c.entry_closes, 'infinity') <= now() then raise exception 'closed'; end if;
  if v_name = '' or char_length(v_name) > 120 then raise exception 'invalid:full_name'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then raise exception 'invalid:email'; end if;
  if exists (select 1 from public.entries where competition_id = c.id and email = v_email and status in ('paid', 'comped')) then raise exception 'already_entered'; end if;
  if public.places_left(c.id) > 0 then raise exception 'not_full'; end if;
  select * into w from public.waiting_list where competition_id = c.id and email = v_email;
  if found then
    if w.status in ('waiting', 'offered') then
      v_already := true;
      update public.waiting_list set full_name = v_name where id = w.id;
    else
      -- they left or lapsed earlier: back to the end of the queue
      update public.waiting_list set status = 'waiting', full_name = v_name, joined_at = now() where id = w.id;
    end if;
  else
    insert into public.waiting_list (competition_id, email, full_name) values (c.id, v_email, v_name) returning * into w;
  end if;
  select count(*)::int into v_pos from public.waiting_list x
    where x.competition_id = c.id and x.status in ('waiting', 'offered') and x.joined_at <= (select joined_at from public.waiting_list where id = w.id);
  return jsonb_build_object('waiting_id', w.id, 'position', v_pos, 'competition', c.name, 'slug', c.slug,
    'already', v_already, 'window_hours', coalesce((select offer_window_hours from public.entry_settings where competition_id = c.id), 48));
end
$$;

-- Does this offer link work? (the entry page asks, so it can show the form instead of "full")
create or replace function public.waitlist_offer_info(p jsonb) returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce((select jsonb_build_object('ok', true, 'name', w.full_name, 'email', w.email, 'expires_at', o.expires_at)
    from public.offers o join public.waiting_list w on w.id = o.waiting_id
   where w.competition_id = (p->>'competition_id')::uuid and o.outcome is null and o.expires_at > now()
     and o.token_hash = encode(sha256(convert_to(btrim(coalesce(p->>'offer', '')), 'UTF8')), 'hex')), jsonb_build_object('ok', false))
$$;

-- Housekeeping for one competition: marks offers taken up, ends offers that ran out, and lists reminders to send.
-- Returns what to email: [{kind: 'expired' | 'reminder', waiting_id, email, name, expires_at}]
create or replace function public.waitlist_sweep(c uuid) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  remind integer := coalesce((select offer_reminder_hours from public.entry_settings where competition_id = c), 12);
  out jsonb := '[]'::jsonb;
  r record;
begin
  -- taken up: they have a paid or free entry from the offer
  update public.offers o set outcome = 'entered'
    where o.outcome is null and exists (select 1 from public.waiting_list w join public.entries e on e.waiting_id = w.id
      where w.id = o.waiting_id and w.competition_id = c and e.status in ('paid', 'comped'));
  update public.waiting_list w set status = 'entered'
    where w.competition_id = c and w.status = 'offered' and exists (select 1 from public.entries e where e.waiting_id = w.id and e.status in ('paid', 'comped'));
  -- ran out (and they are not midway through paying)
  for r in
    select o.id, w.id as wid, w.email, w.full_name, o.expires_at from public.offers o join public.waiting_list w on w.id = o.waiting_id
     where w.competition_id = c and o.outcome is null and o.expires_at <= now()
       and not exists (select 1 from public.entries e where e.waiting_id = w.id and e.status = 'held' and e.hold_expires_at > now())
  loop
    update public.offers set outcome = 'lapsed' where id = r.id;
    update public.waiting_list set status = 'lapsed' where id = r.wid;
    out := out || jsonb_build_array(jsonb_build_object('kind', 'expired', 'waiting_id', r.wid, 'email', r.email, 'name', r.full_name, 'expires_at', r.expires_at));
  end loop;
  -- reminders, once, when the offer is nearly over
  for r in
    select o.id, w.id as wid, w.email, w.full_name, o.expires_at from public.offers o join public.waiting_list w on w.id = o.waiting_id
     where w.competition_id = c and o.outcome is null and o.expires_at > now() and o.reminder_sent_at is null
       and o.expires_at - make_interval(hours => remind) <= now()
       and not exists (select 1 from public.entries e where e.waiting_id = w.id and e.status in ('held', 'paid', 'comped'))
  loop
    update public.offers set reminder_sent_at = now() where id = r.id;
    out := out || jsonb_build_array(jsonb_build_object('kind', 'reminder', 'waiting_id', r.wid, 'email', r.email, 'name', r.full_name, 'expires_at', r.expires_at));
  end loop;
  return out;
end
$$;

-- Who should be offered a place now: the longest-waiting, as many as there are free places. Nobody once entries are closed,
-- and nobody if the competition is set to offer by hand.
create or replace function public.waitlist_candidates(c uuid) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare k public.competitions%rowtype; n integer;
begin
  select * into k from public.competitions where id = c;
  if not found or k.entry_method <> 'yne' or k.entries_closed_manually or coalesce(k.entry_closes, 'infinity') <= now() then return '[]'::jsonb; end if;
  if not coalesce((select offer_automatic from public.entry_settings where competition_id = c), true) then return '[]'::jsonb; end if;
  n := public.places_left(c);
  if n < 1 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('waiting_id', x.id, 'email', x.email, 'name', x.full_name) order by x.joined_at)
    from (select * from public.waiting_list where competition_id = c and status = 'waiting' order by joined_at limit n) x), '[]'::jsonb);
end
$$;

-- Makes the offer (the emailed token is never stored, only its hash). Rechecks there is still a place.
create or replace function public.waitlist_make_offer(wid uuid, token_hash text) returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare w public.waiting_list%rowtype; hrs integer; v_exp timestamptz;
begin
  select * into w from public.waiting_list where id = wid for update;
  if not found or w.status <> 'waiting' then raise exception 'not_waiting'; end if;
  perform 1 from public.competitions where id = w.competition_id for update;       -- one at a time per competition
  if public.places_left(w.competition_id) < 1 then raise exception 'no_place'; end if;
  hrs := coalesce((select offer_window_hours from public.entry_settings where competition_id = w.competition_id), 48);
  v_exp := now() + make_interval(hours => hrs);
  insert into public.offers (waiting_id, token_hash, expires_at) values (wid, token_hash, v_exp);
  update public.waiting_list set status = 'offered' where id = wid;
  return v_exp;
end
$$;

-- If the email could not be sent, take the offer back so they keep their place in the queue.
create or replace function public.waitlist_unoffer(wid uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.offers where waiting_id = wid and outcome is null and not exists (select 1 from public.entries e where e.waiting_id = wid);
  update public.waiting_list set status = 'waiting' where id = wid and status = 'offered';
end
$$;

-- Competitions that have someone waiting or an offer open (what the timer works through).
create or replace function public.waitlist_competitions() returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(distinct w.competition_id), '[]'::jsonb) from public.waiting_list w where w.status in ('waiting', 'offered')
$$;

-- The entries team can take someone off the list (or withdraw an offer); the next person is then offered the place.
create or replace function public.waitlist_remove(wid uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_entries() then raise exception 'forbidden'; end if;
  update public.offers set outcome = 'declined' where waiting_id = wid and outcome is null;
  update public.waiting_list set status = 'removed' where id = wid and status in ('waiting', 'offered');
end
$$;
revoke all on function public.waitlist_join(jsonb), public.waitlist_offer_info(jsonb), public.waitlist_sweep(uuid), public.waitlist_candidates(uuid),
  public.waitlist_make_offer(uuid, text), public.waitlist_unoffer(uuid), public.waitlist_competitions(), public.waitlist_remove(uuid) from public, anon, authenticated;
grant execute on function public.waitlist_remove(uuid) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.waitlist_join(jsonb), public.waitlist_offer_info(jsonb), public.waitlist_sweep(uuid), public.waitlist_candidates(uuid),
      public.waitlist_make_offer(uuid, text), public.waitlist_unoffer(uuid), public.waitlist_competitions() to service_role;
  end if;
end $$;

-- Marks an entry paid once Stripe confirms the payment. Stripe's checkout lasts longer than our hold,
-- so a payment can arrive after the hold ran out: it is accepted if a place is still free, otherwise
-- the caller refunds it ('no_place'). Safe to call twice.
create or replace function public.confirm_entry_payment(e uuid) returns text
language plpgsql security definer set search_path = public
as $$
declare r public.entries%rowtype;
begin
  select * into r from public.entries where id = e;
  if not found then return 'missing'; end if;
  perform 1 from public.competitions where id = r.competition_id for update;
  select * into r from public.entries where id = e;
  if r.status in ('paid', 'comped') then return 'paid'; end if;
  if r.status = 'refunded' then return 'no_place'; end if;
  if not (r.status = 'held' and r.hold_expires_at > now()) and public.places_left(r.competition_id) < 1 then
    return 'no_place';
  end if;
  update public.entries set status = 'paid', paid_at = now(), hold_expires_at = null,
    cancelled_at = null, cancel_reason = '' where id = e;
  update public.invites set used_at = now() where entry_id = e and used_at is null;
  return 'paid';
end
$$;
revoke all on function public.confirm_entry_payment(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.confirm_entry_payment(uuid) to service_role;
  end if;
end $$;

-- Weight classes (IPF). Men's 53 and women's 43 are offered to sub-juniors only. Admins can change these.
insert into public.weight_classes (sex, label, upper_kg, sort_order, min_age_category) values
  ('M', '53', 53, 1, 'SJ'), ('M', '59', 59, 2, ''), ('M', '66', 66, 3, ''), ('M', '74', 74, 4, ''), ('M', '83', 83, 5, ''),
  ('M', '93', 93, 6, ''), ('M', '105', 105, 7, ''), ('M', '120', 120, 8, ''), ('M', '120+', null, 9, ''),
  ('F', '43', 43, 1, 'SJ'), ('F', '47', 47, 2, ''), ('F', '52', 52, 3, ''), ('F', '57', 57, 4, ''), ('F', '63', 63, 5, ''),
  ('F', '69', 69, 6, ''), ('F', '76', 76, 7, ''), ('F', '84', 84, 8, ''), ('F', '84+', null, 9, '')
on conflict (sex, label) do nothing;

-- ---------------------------------------------------------------------------
-- 17. Entry settings, saved in one step by the entries team (admin screen)
--     The entries team cannot edit the competition itself (that is the editors' job), so this
--     function does the entry parts for them: how entry is taken, the events and equipment, the
--     hold time and the prices. (Places, opening and closing are set on the Calendar.) Prices are in whole pence:
--       prices = {"sub_junior": 2500 | null, "bench_only": 2500, "full_power": 6000}
--     The sub-junior price, when set, applies to sub-juniors in any event (first match wins).
-- ---------------------------------------------------------------------------
create or replace function public.save_entry_settings(c uuid, p jsonb) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_events text[];
  v_equip text[];
  v_hold integer := coalesce((p->>'hold_minutes')::int, 5);
  v_sj integer := nullif(p#>>'{prices,sub_junior}', '')::int;
  v_bench integer := nullif(p#>>'{prices,bench_only}', '')::int;
  v_full integer := nullif(p#>>'{prices,full_power}', '')::int;
  v_method text := coalesce(p->>'entry_method', 'external');
  v_guest_days integer := coalesce((p->>'guest_delay_days')::int, 14);
  v_offer_hours integer := coalesce((p->>'offer_window_hours')::int, 48);
  v_ipf text := case when coalesce((p->>'openipf_required')::boolean, false) then 'required' else 'optional' end;
begin
  if not public.is_entries() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.competitions where id = c) then raise exception 'not_found'; end if;
  if v_method not in ('yne', 'external') then raise exception 'invalid:entry_method'; end if;
  select coalesce(array_agg(x), '{}') into v_events from jsonb_array_elements_text(coalesce(p->'events', '[]')) x;
  select coalesce(array_agg(x), '{}') into v_equip from jsonb_array_elements_text(coalesce(p->'equipment', '[]')) x;

  if v_method = 'yne' then
    if cardinality(v_events) = 0 or not (v_events <@ array['full_power', 'bench_only']) then raise exception 'invalid:events'; end if;
    if cardinality(v_equip) = 0 or not (v_equip <@ array['classic', 'equipped']) then raise exception 'invalid:equipment'; end if;
    if v_hold < 5 or v_hold > 30 then raise exception 'invalid:hold_minutes'; end if;
    if v_guest_days < 0 or v_guest_days > 90 then raise exception 'invalid:guest_delay_days'; end if;
    if v_offer_hours < 1 or v_offer_hours > 168 then raise exception 'invalid:offer_window_hours'; end if;
    if 'full_power' = any (v_events) and (v_full is null or v_full < 1) then raise exception 'invalid:price_full_power'; end if;
    if 'bench_only' = any (v_events) and (v_bench is null or v_bench < 1) then raise exception 'invalid:price_bench_only'; end if;
    if v_sj is not null and v_sj < 1 then raise exception 'invalid:price_sub_junior'; end if;
    if coalesce((select capacity from public.competitions where id = c), 0) < 1 then raise exception 'invalid:capacity'; end if;
  end if;

  update public.competitions set entry_method = v_method,
    entries_closed_manually = coalesce((p->>'entries_closed_manually')::boolean, false),
    is_franchise = coalesce((p->>'is_franchise')::boolean, is_franchise)
    where id = c;
  insert into public.entry_settings (competition_id, events, equipment, hold_minutes, openipf_mode, guest_delay_days, offer_window_hours, updated_at)
    values (c, case when cardinality(v_events) = 0 then array['full_power', 'bench_only'] else v_events end,
            case when cardinality(v_equip) = 0 then array['classic', 'equipped'] else v_equip end,
            v_hold, v_ipf, v_guest_days, least(greatest(v_offer_hours, 1), 168), now())
    on conflict (competition_id) do update set events = excluded.events, equipment = excluded.equipment,
      hold_minutes = excluded.hold_minutes, openipf_mode = excluded.openipf_mode, guest_delay_days = excluded.guest_delay_days,
      offer_window_hours = excluded.offer_window_hours, updated_at = now();

  if v_method = 'yne' then
    delete from public.price_rules where competition_id = c;
    if v_sj is not null then
      insert into public.price_rules (competition_id, sort_order, label, age_category, price_pence) values (c, 1, 'Sub-junior, any event', 'SJ', v_sj);
    end if;
    if v_bench is not null then
      insert into public.price_rules (competition_id, sort_order, label, event, price_pence) values (c, 2, 'Bench only', 'bench_only', v_bench);
    end if;
    if v_full is not null then
      insert into public.price_rules (competition_id, sort_order, label, event, price_pence) values (c, 3, 'Full power', 'full_power', v_full);
    end if;
  end if;
end
$$;
revoke all on function public.save_entry_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_entry_settings(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 18. Priority entry: personal links
--     Priority entry opens one day before general entry. The entries team lists the emails that get it
--     (later, volunteer points will fill this list). Each email gets a personal, single-use link. Only a
--     fingerprint of the link is stored, so the full links are shown once, when they are made. Making new
--     links for an email replaces its unused older one.
-- ---------------------------------------------------------------------------
create or replace function public.create_priority_invites(c uuid, emails text[]) returns table (email text, token text)
language plpgsql security definer set search_path = public
as $$
declare e text; t text;
begin
  if not public.is_entries() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.competitions where id = c) then raise exception 'not_found'; end if;
  foreach e in array (select coalesce(array_agg(distinct lower(trim(x))), '{}') from unnest(emails) x where trim(x) <> '') loop
    if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email:%', e; end if;
    delete from public.invites i where i.competition_id = c and i.email = e and i.used_at is null;
    t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.invites (competition_id, email, token_hash) values (c, e, encode(sha256(convert_to(t, 'UTF8')), 'hex'));
    email := e; token := t; return next;
  end loop;
end
$$;
revoke all on function public.create_priority_invites(uuid, text[]) from public, anon;
grant execute on function public.create_priority_invites(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 19. Manual entries (entries team only)
--     For lifters who are given a free place, or who paid another way (cash, bank transfer, a payment link). The same
--     checks on the person and the class as the entry form, but not the opening times, the guest delay or the hold:
--     this is the entries team deciding. A free entry has no money; "paid elsewhere" records the amount for the
--     money report with no Stripe fee.  mode: 'comped' | 'paid_elsewhere'
-- ---------------------------------------------------------------------------
create or replace function public.add_manual_entry(c uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  comp public.competitions%rowtype;
  v_email text := lower(trim(coalesce(p->>'email', '')));
  v_name text := trim(coalesce(p->>'full_name', ''));
  v_dob date;
  v_sex text := p->>'sex';
  v_class uuid := nullif(p->>'weight_class_id', '')::uuid;
  v_mode text := coalesce(p->>'mode', 'comped');
  v_price integer := case when coalesce(p->>'mode', 'comped') = 'paid_elsewhere' then coalesce((p->>'price_pence')::int, -1) else 0 end;
  v_event text := p->>'event';
  v_equip text := p->>'equipment';
  v_age integer;
  v_div public.divisions%rowtype;
  v_entry uuid;
  v_over boolean;
begin
  if not public.is_entries() then raise exception 'forbidden'; end if;
  select * into comp from public.competitions where id = c for update;
  if not found then raise exception 'not_found'; end if;
  if v_mode not in ('comped', 'paid_elsewhere') then raise exception 'invalid:mode'; end if;
  if v_name = '' then raise exception 'invalid:full_name'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email'; end if;
  begin v_dob := (p->>'date_of_birth')::date; exception when others then raise exception 'invalid:date_of_birth'; end;
  if v_dob is null or v_dob > comp.start_date or v_dob < date '1900-01-01' then raise exception 'invalid:date_of_birth'; end if;
  if public.age_category_on(v_dob, comp.start_date) = 'under14' then raise exception 'invalid:too_young'; end if;
  if v_sex not in ('M', 'F') then raise exception 'invalid:sex'; end if;
  if v_event not in ('full_power', 'bench_only') then raise exception 'invalid:event'; end if;
  if v_equip not in ('classic', 'equipped') then raise exception 'invalid:equipment'; end if;
  if v_price < 0 then raise exception 'invalid:price'; end if;
  if v_class is null or not exists (select 1 from public.weight_classes w where w.id = v_class and w.sex = v_sex and w.active
      and (w.min_age_category = '' or w.min_age_category = public.age_category_on(v_dob, comp.start_date))) then raise exception 'invalid:weight_class'; end if;
  select * into v_div from public.divisions where id = nullif(p->>'division_id', '')::uuid;
  if not found then raise exception 'invalid:division'; end if;
  v_age := public.age_on(v_dob, comp.start_date);
  if v_age < 18 and (coalesce(trim(p->>'guardian_name'), '') = '' or coalesce(trim(p->>'guardian_phone'), '') = '' or coalesce(trim(p->>'guardian_email'), '') = '') then
    raise exception 'invalid:guardian';
  end if;
  if exists (select 1 from public.entries where competition_id = c and email = v_email and status in ('paid', 'comped', 'held')) then raise exception 'already_entered'; end if;
  v_over := public.places_left(c) < 1;

  insert into public.entries (competition_id, status, source, email, full_name, display_name, bp_number, date_of_birth, sex, division_id, club, instagram,
      photo_ok, photo_opt_out, weight_class_id, equipment, event, openipf_url, price_pence, paid_at, is_guest, entry_note, list_price_pence)
    values (c, case when v_mode = 'comped' then 'comped' else 'paid' end, 'manual', v_email, v_name, trim(coalesce(p->>'display_name', '')), trim(coalesce(p->>'bp_number', '')), v_dob, v_sex,
      v_div.id, trim(coalesce(p->>'club', '')), trim(coalesce(p->>'instagram', '')), coalesce((p->>'photo_ok')::boolean, false), coalesce((p->>'photo_opt_out')::boolean, false),
      v_class, v_equip, v_event, trim(coalesce(p->>'openipf_url', '')), v_price, now(), not v_div.is_home, trim(coalesce(p->>'note', '')),
      case when v_mode = 'comped' then coalesce(public.entry_price(c, v_dob, v_event, v_equip), 0) else v_price end)
    returning id into v_entry;
  insert into public.entry_private (entry_id, guardian_name, guardian_phone, guardian_email, guardian_consent, delete_after)
    values (v_entry, case when v_age < 18 then trim(p->>'guardian_name') else '' end, case when v_age < 18 then trim(p->>'guardian_phone') else '' end,
            case when v_age < 18 then trim(p->>'guardian_email') else '' end, v_age < 18, coalesce(comp.end_date, comp.start_date) + 30);
  return jsonb_build_object('entry_id', v_entry, 'over_capacity', v_over);
end
$$;
revoke all on function public.add_manual_entry(uuid, jsonb) from public, anon;
grant execute on function public.add_manual_entry(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 20. Discount codes: price, checking and making them
-- ---------------------------------------------------------------------------
-- What a code does to a price. Returns {ok, id, discount_pence, price_pence} or {ok: false, error}, where error is
-- invalid | expired | not_yours | used. A held place counts as a use until it expires, so a one-use code cannot be shared out twice.
create or replace function public.discount_apply(p_code text, comp uuid, p_email text, base integer) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare d public.discount_codes%rowtype; uses integer; disc integer;
begin
  select * into d from public.discount_codes where code_key = upper(btrim(coalesce(p_code, '')));
  if not found or not d.active then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if d.competition_id is not null and d.competition_id <> comp then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if d.expires_at is not null and d.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if d.recipient_email <> '' and d.recipient_email <> lower(btrim(coalesce(p_email, ''))) then return jsonb_build_object('ok', false, 'error', 'not_yours'); end if;
  select count(*) into uses from public.entries e
    where e.discount_code_id = d.id and (e.status in ('paid', 'comped') or (e.status = 'held' and e.hold_expires_at > now()));
  if uses >= d.max_uses then return jsonb_build_object('ok', false, 'error', 'used'); end if;
  disc := case d.kind when 'percent' then round(base * least(d.value, 100) / 100.0)::int else least(d.value, base) end;
  disc := greatest(least(disc, base), 0);
  return jsonb_build_object('ok', true, 'id', d.id, 'discount_pence', disc, 'price_pence', base - disc);
end
$$;
revoke all on function public.discount_apply(text, uuid, text, integer) from public, anon, authenticated;

-- The price for an entry before any discount (the first price rule that matches).
create or replace function public.entry_price(c uuid, dob date, ev text, eq text) returns integer
language sql stable security definer set search_path = public
as $$
  select r.price_pence from public.price_rules r join public.competitions k on k.id = r.competition_id
  where r.competition_id = c and (r.event is null or r.event = ev) and (r.equipment is null or r.equipment = eq)
    and (r.age_category is null or r.age_category = public.age_category_on(dob, k.start_date))
  order by r.sort_order, r.label limit 1
$$;
revoke all on function public.entry_price(uuid, date, text, text) from public, anon, authenticated;

-- "Would this code work, and what would the total be?" for the entry form. Called only by the payment function.
create or replace function public.check_discount(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare base integer; r jsonb;
begin
  base := public.entry_price((p->>'competition_id')::uuid, (p->>'date_of_birth')::date, p->>'event', p->>'equipment');
  if base is null then return jsonb_build_object('ok', false, 'error', 'no_price'); end if;
  r := public.discount_apply(p->>'code', (p->>'competition_id')::uuid, p->>'email', base);
  if (r->>'ok')::boolean then return jsonb_build_object('ok', true, 'base_pence', base, 'discount_pence', r->'discount_pence', 'price_pence', r->'price_pence'); end if;
  return r;
exception when others then
  return jsonb_build_object('ok', false, 'error', 'invalid');
end
$$;
revoke all on function public.check_discount(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.check_discount(jsonb) to service_role;
  end if;
end $$;

-- Make a code (entries team only). c is the competition, or null for a code that works for any competition. p:
--   recipient_name, recipient_email (optional), kind ('percent' | 'amount'), value (percent, or pence), max_uses (default 1),
--   expires_at (optional), reason.   The code is made from the name and the discount plus random letters, e.g. SAM-20OFF-K7XQ2M.
create or replace function public.create_discount_code(c uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_kind text := p->>'kind'; v_value integer := (p->>'value')::int; v_max integer := coalesce((p->>'max_uses')::int, 1);
  v_name text := btrim(coalesce(p->>'recipient_name', '')); v_email text := lower(btrim(coalesce(p->>'recipient_email', '')));
  v_prefix text; v_label text; v_code text; v_who text; v_row public.discount_codes%rowtype; tries integer := 0; u text;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if not public.is_entries() then raise exception 'forbidden'; end if;
  if c is not null and not exists (select 1 from public.competitions where id = c) then raise exception 'not_found'; end if;
  if v_kind not in ('percent', 'amount') then raise exception 'invalid:kind'; end if;
  if v_value is null or v_value < 1 or (v_kind = 'percent' and v_value > 100) or (v_kind = 'amount' and v_value > 100000) then raise exception 'invalid:value'; end if;
  if v_max < 1 or v_max > 1000 then raise exception 'invalid:max_uses'; end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid:email'; end if;
  v_prefix := left(upper(regexp_replace(v_name, '[^A-Za-z]', '', 'g')), 10);
  if v_prefix = '' then v_prefix := 'YNE'; end if;
  v_label := case when v_kind = 'percent' then (case when v_value = 100 then 'FREE' when v_value = 50 then 'HALF' else v_value::text || 'PCT' end)
                  else (case when v_value % 100 = 0 then (v_value / 100)::text else replace(to_char(v_value / 100.0, 'FM990.00'), '.', 'P') end) || 'OFF' end;
  select coalesce(email, 'unknown') into v_who from auth.users where id = auth.uid();
  loop
    u := replace(gen_random_uuid()::text, '-', '');
    v_code := v_prefix || '-' || v_label || '-' || (select string_agg(substr(alphabet, (('x' || substr(u, i * 2 - 1, 2))::bit(8)::int % length(alphabet)) + 1, 1), '') from generate_series(1, 6) i);
    exit when not exists (select 1 from public.discount_codes where code_key = upper(v_code));
    tries := tries + 1; if tries > 20 then raise exception 'could not make a unique code'; end if;
  end loop;
  insert into public.discount_codes (competition_id, code, recipient_name, recipient_email, kind, value, max_uses, expires_at, reason, created_by)
    values (c, v_code, v_name, v_email, v_kind, v_value, v_max, nullif(p->>'expires_at', '')::timestamptz, btrim(coalesce(p->>'reason', '')), coalesce(v_who, ''))
    returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code);
end
$$;
revoke all on function public.create_discount_code(uuid, jsonb) from public, anon;
grant execute on function public.create_discount_code(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 21. Who gets paid (entries team only)
--     Sets, for one competition, how the money is split. The host gets host_entry_percent of the entry money and the
--     federation keeps the rest; merchandise goes mostly or wholly to the host; photo packages go to the photographer.
--     The federation always has a row (even at 0%) so it receives any Stripe fee pence left over in the report.
-- ---------------------------------------------------------------------------
insert into public.payees (name, kind) select 'YNEPF', 'federation' where not exists (select 1 from public.payees where kind = 'federation');

create or replace function public.save_payout_setup(c uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  fed uuid; host uuid; photog uuid;
  host_name text := btrim(coalesce(p->>'host_name', ''));
  photog_name text := btrim(coalesce(p->>'photographer_name', ''));
  m_pct numeric := coalesce((p->>'host_merch_percent')::numeric, 100);
  p_pct numeric := coalesce((p->>'photographer_percent')::numeric, 100);
  existing record; franchise boolean;
begin
  if not public.is_entries() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.competitions where id = c) then raise exception 'not_found'; end if;
  franchise := coalesce((select is_franchise from public.competitions where id = c), true);
  if franchise and host_name = '' then raise exception 'invalid:host_name'; end if;
  if m_pct < 0 or m_pct > 100 or p_pct < 0 or p_pct > 100 then raise exception 'invalid:percent'; end if;
  select id into fed from public.payees where kind = 'federation' limit 1;
  if fed is null then insert into public.payees (name, kind) values ('YNEPF', 'federation') returning id into fed; end if;

  if host_name <> '' then
    select * into existing from public.payees where lower(name) = lower(host_name);
    if found then
      if existing.kind <> 'host' then raise exception 'invalid:payee_kind'; end if;
      host := existing.id;
    else
      insert into public.payees (name, kind) values (host_name, 'host') returning id into host;
    end if;
  end if;
  if photog_name <> '' then
    select * into existing from public.payees where lower(name) = lower(photog_name);
    if found then
      if existing.kind <> 'photographer' then raise exception 'invalid:payee_kind'; end if;
      photog := existing.id;
    else
      insert into public.payees (name, kind) values (photog_name, 'photographer') returning id into photog;
    end if;
  end if;

  update public.competitions set host_payee_id = host where id = c;     -- the host is paid the entry fee less the federation's fixed amount
  delete from public.payout_rules where competition_id = c;
  if host is null then m_pct := 0; end if;          -- no host: the federation keeps any merchandise money
  insert into public.payout_rules (competition_id, category, payee_id, percent) values (c, 'merch', fed, 100 - m_pct);
  if m_pct > 0 then insert into public.payout_rules (competition_id, category, payee_id, percent) values (c, 'merch', host, m_pct); end if;
  if photog is not null then
    insert into public.payout_rules (competition_id, category, payee_id, percent) values (c, 'photo', fed, 100 - p_pct);
    if p_pct > 0 then insert into public.payout_rules (competition_id, category, payee_id, percent) values (c, 'photo', photog, p_pct); end if;
  end if;
  return jsonb_build_object('host_id', host, 'federation_id', fed, 'photographer_id', photog);
end
$$;
revoke all on function public.save_payout_setup(uuid, jsonb) from public, anon;
grant execute on function public.save_payout_setup(uuid, jsonb) to authenticated;

-- Change what the federation keeps from each entry for ONE competition (entries team only). The defaults for new competitions are
-- changed on the federation_fees table instead.
create or replace function public.save_competition_fees(c uuid, p jsonb) returns void
language plpgsql security definer set search_path = public
as $$
declare f integer := (p->>'full_power')::int; b integer := (p->>'bench_only')::int; j integer := (p->>'sub_junior')::int;
begin
  if not public.is_entries() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.competitions where id = c) then raise exception 'not_found'; end if;
  if f is null or b is null or j is null or f < 0 or b < 0 or j < 0 or f > 100000 or b > 100000 or j > 100000 then raise exception 'invalid:fees'; end if;
  update public.competitions set fee_full_power_pence = f, fee_bench_only_pence = b, fee_sub_junior_pence = j where id = c;
end
$$;
revoke all on function public.save_competition_fees(uuid, jsonb) from public, anon;
grant execute on function public.save_competition_fees(uuid, jsonb) to authenticated;
