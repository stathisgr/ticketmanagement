-- ============================================================================
--  Ticket Manager — ONLINE booking cloud schema (Supabase / Postgres)
--  Αυτόνομη online βάση. ΔΕΝ συνδέεται real-time με το τοπικό ταμείο.
--  Συγχρονισμός = προγραμματισμένος, μονόδρομος (π.χ. ~1 ώρα πριν το θέαμα).
--  Εφαρμογή: Supabase SQL Editor  ή  supabase db push.
-- ============================================================================

-- Καθαρό (ξανατρέξιμο σε demo). Σχόλιασέ το σε production.
drop table if exists tickets         cascade;
drop table if exists order_items     cascade;
drop table if exists orders          cascade;
drop table if exists seat_holds      cascade;
drop table if exists seats           cascade;
drop table if exists ticket_types    cascade;
drop table if exists shows           cascade;
drop table if exists sync_log        cascade;

-- ----------------------------------------------------------------------------
-- SHOWS — ο online κατάλογος θεαμάτων (publish-only)
--   seating_mode: 'seated' = επιλογή θέσης | 'general' = ελεύθερη είσοδος/προϊόν
--   online_capacity: μόνο για general — πόσα εισιτήρια διατίθενται online
-- ----------------------------------------------------------------------------
create table shows (
  id              bigint generated always as identity primary key,
  local_id        bigint,                       -- αντιστοιχία με το τοπικό show (για sync)
  title           text    not null,
  subtitle        text    default '',
  description     text    default '',
  image_url       text,
  venue_name      text    default '',
  show_date       date    not null,
  start_time      text    not null default '21:00',  -- 'HH:MM'
  end_time        text,
  seating_mode    text    not null default 'seated'
                    check (seating_mode in ('seated','general')),
  online_capacity int     default 0,            -- general mode
  online_sold     int     default 0,            -- general mode (μετρητής)
  brand_color     text    default '#7c2d12',
  legal_note      text    default 'Δεν αποτελεί φορολογικό παραστατικό',
  sales_close_at  timestamptz,                  -- μετά από αυτό κλείνει η online πώληση
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index shows_browse_idx on shows (enabled, show_date);

-- ----------------------------------------------------------------------------
-- TICKET TYPES — τιμές ανά θέαμα (Κανονικό / Φοιτητικό / Παιδικό ...)
-- ----------------------------------------------------------------------------
create table ticket_types (
  id          bigint generated always as identity primary key,
  show_id     bigint  not null references shows(id) on delete cascade,
  local_id    bigint,
  title       text    not null,
  price_cents int     not null check (price_cents >= 0),
  vat_rate    numeric(5,2) not null default 6,
  sort        int     default 0,
  enabled     boolean not null default true
);
create index ticket_types_show_idx on ticket_types (show_id);

-- ----------------------------------------------------------------------------
-- SEATS — μόνο για seating_mode='seated'
--   channel: 'online' = διατίθεται online | 'box_office' = μόνο τοπικά
--   (inventory partitioning ώστε να μην διπλοπωληθεί πριν τρέξει ο sync)
--   status: 'free' | 'sold'   (το 'held' το χειρίζεται ο πίνακας seat_holds)
--   sold_channel: ποιο κανάλι το πούλησε (για reconciliation)
-- ----------------------------------------------------------------------------
create table seats (
  id            bigint generated always as identity primary key,
  show_id       bigint not null references shows(id) on delete cascade,
  local_seat_id bigint,
  zone          text   default '',
  row_label     text   default '',
  seat_label    text   not null,           -- π.χ. 'Α4-12'
  channel       text   not null default 'online'
                  check (channel in ('online','box_office')),
  status        text   not null default 'free'
                  check (status in ('free','sold')),
  sold_channel  text   check (sold_channel in ('online','box_office')),
  unique (show_id, seat_label)
);
create index seats_avail_idx on seats (show_id, channel, status);

-- ----------------------------------------------------------------------------
-- SEAT HOLDS — προσωρινή δέσμευση όσο ο πελάτης πληρώνει (λήγει με expires_at)
--   Καθαρίζονται από Edge Function/cron ή ελέγχονται κατά την οριστικοποίηση.
-- ----------------------------------------------------------------------------
create table seat_holds (
  id          bigint generated always as identity primary key,
  show_id     bigint not null references shows(id) on delete cascade,
  seat_id     bigint references seats(id) on delete cascade,  -- null = general
  hold_token  uuid   not null,             -- ταυτότητα συνεδρίας πελάτη
  qty         int    not null default 1,   -- general mode
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index seat_holds_expiry_idx on seat_holds (expires_at);
create unique index seat_holds_seat_uq on seat_holds (seat_id) where seat_id is not null;

-- ----------------------------------------------------------------------------
-- ORDERS — μία online αγορά (πληρωμή Viva)
-- ----------------------------------------------------------------------------
create table orders (
  id              bigint generated always as identity primary key,
  show_id         bigint not null references shows(id),
  hold_token      uuid,
  customer_name   text,
  customer_email  text not null,
  customer_phone  text,
  amount_cents    int  not null,
  currency        text not null default 'EUR',
  status          text not null default 'pending'
                    check (status in ('pending','paid','cancelled','expired')),
  viva_order_code text,                     -- Smart Checkout orderCode
  viva_state_id   int,                      -- 3 = Paid
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);
create index orders_status_idx on orders (status, created_at);
create index orders_viva_idx   on orders (viva_order_code);

create table order_items (
  id             bigint generated always as identity primary key,
  order_id       bigint not null references orders(id) on delete cascade,
  ticket_type_id bigint references ticket_types(id),
  seat_id        bigint references seats(id),
  price_cents    int not null
);

-- ----------------------------------------------------------------------------
-- TICKETS — εκδομένα online εισιτήρια (παράγονται μετά την πληρωμή)
--   serial_uid: το ίδιο schema με το τοπικό QR/check-in
-- ----------------------------------------------------------------------------
create table tickets (
  id             bigint generated always as identity primary key,
  order_id       bigint not null references orders(id) on delete cascade,
  show_id        bigint not null references shows(id),
  seat_id        bigint references seats(id),
  ticket_type_id bigint references ticket_types(id),
  serial         text not null,
  serial_uid     uuid not null default gen_random_uuid(),  -- περιεχόμενο QR
  price_cents    int  not null,
  ticket_url     text,                        -- hosted HTML εισιτήριο
  pdf_url        text,                        -- αρχείο στο Storage
  checked_in_at  timestamptz,                 -- συμπληρώνεται από sync/check-in
  created_at     timestamptz not null default now(),
  unique (serial_uid)
);
create index tickets_show_idx  on tickets (show_id);
create index tickets_order_idx on tickets (order_id);

-- ----------------------------------------------------------------------------
-- SYNC LOG — ίχνος των συγχρονισμών με την τοπική βάση
-- ----------------------------------------------------------------------------
create table sync_log (
  id          bigint generated always as identity primary key,
  direction   text not null check (direction in ('push_catalog','pull_sales')),
  show_id     bigint,
  rows        int  default 0,
  note        text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- VIEW: διαθεσιμότητα θέσεων online (free, online channel, χωρίς ενεργό hold)
-- ----------------------------------------------------------------------------
create or replace view v_seat_availability as
select s.id as seat_id, s.show_id, s.zone, s.row_label, s.seat_label,
       (s.status = 'free'
        and not exists (
          select 1 from seat_holds h
          where h.seat_id = s.id and h.expires_at > now()
        )) as available
from seats s
where s.channel = 'online';

-- ----------------------------------------------------------------------------
-- updated_at trigger για shows
-- ----------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
drop trigger if exists shows_touch on shows;
create trigger shows_touch before update on shows
  for each row execute function touch_updated_at();

-- ============================================================================
--  ROW LEVEL SECURITY
--  Ο επισκέπτης (anon) διαβάζει ΜΟΝΟ τον κατάλογο + διαθεσιμότητα.
--  ΟΛΕΣ οι εγγραφές (holds, orders, tickets) γίνονται από Edge Functions
--  με το service_role key, που παρακάμπτει το RLS. Καμία απευθείας εγγραφή.
-- ============================================================================
alter table shows         enable row level security;
alter table ticket_types  enable row level security;
alter table seats         enable row level security;
alter table seat_holds    enable row level security;
alter table orders        enable row level security;
alter table order_items   enable row level security;
alter table tickets       enable row level security;

-- Δημόσια ανάγνωση καταλόγου (μόνο ενεργά θεάματα)
create policy shows_public_read on shows
  for select to anon using (enabled = true);

create policy ticket_types_public_read on ticket_types
  for select to anon using (
    enabled = true and exists (select 1 from shows s where s.id = show_id and s.enabled)
  );

-- Διαθεσιμότητα θέσεων: δημόσια ανάγνωση seats (όχι holds/orders/tickets)
create policy seats_public_read on seats
  for select to anon using (channel = 'online');

-- holds / orders / order_items / tickets: ΚΑΜΙΑ πρόσβαση anon (default deny).
-- (Οι Edge Functions με service_role τα διαχειρίζονται.)

-- ============================================================================
--  DEMO ΔΕΔΟΜΕΝΑ — ένα seated θέαμα 3x4 με 6 online θέσεις
-- ============================================================================
insert into shows (title, subtitle, venue_name, show_date, start_time, seating_mode, brand_color)
values ('Αντιγόνη', 'Σοφοκλέους — Θερινή παράσταση', 'ΔΗΜΟΤΙΚΟ ΘΕΑΤΡΟ',
        current_date + 14, '21:00', 'seated', '#7c2d12');

insert into ticket_types (show_id, title, price_cents, vat_rate, sort)
select id, 'Κανονικό', 1500, 6, 1 from shows where title='Αντιγόνη';
insert into ticket_types (show_id, title, price_cents, vat_rate, sort)
select id, 'Φοιτητικό', 1000, 6, 2 from shows where title='Αντιγόνη';

-- 12 θέσεις (3 σειρές × 4): 6 online, 6 box_office
insert into seats (show_id, row_label, seat_label, channel)
select s.id, r.label, r.label || '-' || c.n,
       case when c.n <= 2 then 'online' else 'box_office' end
from shows s
cross join (values ('Α'),('Β'),('Γ')) as r(label)
cross join (values (1),(2),(3),(4)) as c(n)
where s.title='Αντιγόνη';
