-- ====================================================================================================
-- MIGRATION 407: COMPETEN SCHOLAR -- A STUDENT ORGANISES THEIR OWN LIBRARY (COLLECTIONS, RENAMED MATERIALS)
--
-- COMPETEN-SCHOLAR-UPLOAD-01 (owner GO 2026-10-24), U5: rename materials and organise the library. A
-- collection is a named shelf of the student own materials -- "Respiratory module", "Year 2 placement".
-- It is personal: nobody else sees it, it holds only its owner materials, and it never touches the shared
-- competency catalogue. A material sits on at most one shelf, or none.
--
-- THE OWNER RULE IS IN THE SCHEMA. The material points at its shelf by (collection_id, user_id), a
-- composite foreign key onto the collection (id, user_id), so a material on another person shelf is
-- unstorable. Deleting a collection is done by its owner through the store, which takes its materials off
-- the shelf first (the materials are kept). Erasing a person removes their collections with them.
-- The title CHECK makes a renamed material keep a real name: 1 to 120 characters, the limit the upload
-- already applies to a title taken from a file name.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: one new table, one nullable column, one CHECK
-- every existing title already meets. Count first: the rows of individual_scholar_material whose title is
-- empty or longer than 120 characters -- if any exist the CHECK fails and nothing after it is applied.
-- It depends on 372. Re-running it is a no-op.
--
-- FAIL CLOSED WITHOUT IT. The library page offers collections only when this table is readable. Rollback:
-- docs/evidence/COMPETEN-SCHOLAR-UPLOAD-01/ROLLBACK-407.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

create table if not exists individual_scholar_collection (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

alter table individual_scholar_collection drop constraint if exists individual_scholar_collection_name_check;
alter table individual_scholar_collection add constraint individual_scholar_collection_name_check
  check (char_length(btrim(name)) between 1 and 80);

create unique index if not exists ux_individual_scholar_collection_id_user
  on individual_scholar_collection(id, user_id);
create unique index if not exists ux_individual_scholar_collection_user_name
  on individual_scholar_collection(user_id, lower(btrim(name)));

alter table individual_scholar_collection enable row level security;

drop policy if exists individual_scholar_collection_read_own on individual_scholar_collection;
create policy individual_scholar_collection_read_own on individual_scholar_collection
  for select using (auth.uid() = user_id);

comment on table individual_scholar_collection is
  'COMPETEN-SCHOLAR-UPLOAD-01 U5. A named shelf of a Scholar student own materials. Personal, private to its owner, erased with them. Never part of the shared competency catalogue.';

alter table individual_scholar_material add column if not exists collection_id uuid;

alter table individual_scholar_material drop constraint if exists individual_scholar_material_collection_fk;
alter table individual_scholar_material add constraint individual_scholar_material_collection_fk
  foreign key (collection_id, user_id) references individual_scholar_collection(id, user_id);

create index if not exists idx_individual_scholar_material_collection
  on individual_scholar_material(user_id, collection_id);

alter table individual_scholar_material drop constraint if exists individual_scholar_material_title_check;
alter table individual_scholar_material add constraint individual_scholar_material_title_check
  check (char_length(btrim(title)) between 1 and 120);

notify pgrst, 'reload schema';
