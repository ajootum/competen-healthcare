-- 165: Resource Operations (UMW-RES-001) - consumables, stock levels, requests and readiness checks.
--
-- WHAT ALREADY EXISTS AND IS NOT DUPLICATED HERE:
--   op_equipment   equipment and its service status
--   adm_assets     the asset register (tags, custodians, maintenance, calibration, warranty)
--   op_resources   bookable capacity (theatres, treatment rooms, transport)
-- RES-001's equipment, biomedical and point-of-care sections therefore read those stores. Adding a fourth
-- equipment table would guarantee that two pages eventually disagree about whether a defibrillator works.
--
-- WHAT GENUINELY DOES NOT EXIST, and is what this migration adds: the CONSUMABLE side. There is nowhere to
-- record that a unit holds 4 units of O-negative, that its floor level is 6, that someone requested more, or
-- that the crash cart was checked this morning. Without stock levels the spec's "prevent shortages affecting
-- patient care" cannot be answered at all.
--
-- CONFIGURABLE TAXONOMY, as the spec requires ("resource categories configurable", "custom tenant-defined
-- resources"): categories are ROWS, not a check constraint, so a tenant can add one without a migration.
--
-- THRESHOLDS RESOLVE stock-level override -> item default. The spec asks for thresholds configurable by unit,
-- and a ward that keeps a deeper oxygen buffer than theatres is the normal case, not an exception.
--
-- Plain idempotent statements only (no do-blocks). Pure ASCII. RLS: authenticated read, service-role writes.

create table if not exists res_categories (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) on delete cascade,
  code        text not null,
  label       text not null,
  kind        text not null default 'consumable' check (kind in ('consumable','equipment','medication','emergency','other')),
  critical    boolean not null default false,
  sort_order  int not null default 100,
  created_at  timestamptz not null default now(),
  unique (hospital_id, code)
);
create index if not exists idx_res_categories_hospital on res_categories(hospital_id, sort_order);

create table if not exists res_items (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  category_id   uuid references res_categories(id) on delete set null,
  name          text not null,
  code          text,
  unit_of_measure text not null default 'unit',
  min_level     int,                                  -- default floor, overridable per unit on a stock row
  critical_level int,                                 -- default "escalate now" floor
  critical      boolean not null default false,       -- shortage escalates automatically
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_res_items_hospital on res_items(hospital_id, active);

-- On-hand stock for one item at one place. department_id null = held for the hospital rather than a unit.
create table if not exists res_stock (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references hospitals(id) on delete cascade,
  item_id        uuid not null references res_items(id) on delete cascade,
  department_id  uuid references departments(id) on delete set null,
  location       text,
  on_hand        numeric not null default 0,
  min_level      int,                                 -- per-unit override of res_items.min_level
  critical_level int,
  counted_at     timestamptz,
  counted_by     uuid references profiles(id) on delete set null,
  expires_at     date,
  created_at     timestamptz not null default now(),
  unique (item_id, department_id, location)
);
create index if not exists idx_res_stock_hospital on res_stock(hospital_id);
create index if not exists idx_res_stock_item on res_stock(item_id);

-- Request workflow. Approvals are recorded on the row with who and when, because "all requests and approvals
-- auditable" means the decision has to be attributable, not merely that a status changed.
create table if not exists res_requests (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  item_id       uuid references res_items(id) on delete set null,
  description   text,                                 -- for a request with no catalogue item yet
  department_id uuid references departments(id) on delete set null,
  quantity      numeric not null default 1,
  urgency       text not null default 'routine' check (urgency in ('routine','urgent','emergency')),
  status        text not null default 'requested'
                  check (status in ('requested','approved','rejected','ordered','fulfilled','cancelled')),
  reason        text,
  requested_by  uuid references profiles(id) on delete set null,
  requested_by_name text,
  decided_by    uuid references profiles(id) on delete set null,
  decided_by_name text,
  decided_at    timestamptz,
  decision_note text,
  fulfilled_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_res_requests_hospital on res_requests(hospital_id, status, created_at desc);

-- Readiness checks: crash carts, emergency trolleys, point-of-care devices. `passed` is deliberately separate
-- from `issues` - a check that found a problem is still a check that HAPPENED, and a unit that stopped
-- checking must not look identical to one that checks and passes.
create table if not exists res_checks (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null references hospitals(id) on delete cascade,
  asset_id      uuid references adm_assets(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  check_type    text not null default 'crash_cart'
                  check (check_type in ('crash_cart','emergency_trolley','point_of_care','oxygen','defibrillator','other')),
  label         text not null,
  passed        boolean not null default true,
  issues        text,
  checked_at    timestamptz not null default now(),
  checked_by    uuid references profiles(id) on delete set null,
  checked_by_name text,
  next_due_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_res_checks_hospital on res_checks(hospital_id, checked_at desc);

alter table res_categories enable row level security;
alter table res_items enable row level security;
alter table res_stock enable row level security;
alter table res_requests enable row level security;
alter table res_checks enable row level security;

drop policy if exists res_categories_read on res_categories;
create policy res_categories_read on res_categories for select to authenticated using (true);
drop policy if exists res_items_read on res_items;
create policy res_items_read on res_items for select to authenticated using (true);
drop policy if exists res_stock_read on res_stock;
create policy res_stock_read on res_stock for select to authenticated using (true);
drop policy if exists res_requests_read on res_requests;
create policy res_requests_read on res_requests for select to authenticated using (true);
drop policy if exists res_checks_read on res_checks;
create policy res_checks_read on res_checks for select to authenticated using (true);

notify pgrst, 'reload schema';
