# Migration 760: build record (framework Areas, organisational moves in the layout draft)

- **Authority:** owner GO FRAMEWORK-DESIGN-STUDIO-02, 31 Oct 2026, rulings D1 (Area level) and D3 with its refinement (`STATUS.md` in this folder). Implementation only. 750, 751 and 752 are not edited.
- **Branch:** `hq/framework-studio-02b`.
- **File:** `supabase/migrations/760-framework-areas.sql`, sha256 `137d644790ce23940d6c737b3cce19338f1976e13984c4a186a7c76d8f884dad`.
- **Rollback (staging):** `ROLLBACK-760.sql`, sha256 `57366b46d8b4119f49b45806027976ea1157b6e266198b11f3b52ac79ae2531e`. It restores the four redefined functions verbatim from 750, 751 and 752 (extracted from those files), drops the triggers, the column and the table, and refuses while a layout draft carries a 760 key.
- **PRECHECK / VERIFY:** `PRECHECK-760.sql` (sha256 `e722b43f...96e7fd`), `VERIFY-760.sql` (sha256 `94d37828...e512e95`). Both always roll back.
- **House rules:** ALL CLEAR (612 lines, 214 statements, 4 warnings = the APPLY-WHOLE constructs).

## State

**State 2: applied and verified on staging. Production does NOT have it.** Separate owner GO, applied by the owner after 750, 751 and 752. While 760 is absent the app offers no Area or move action (409, nothing written) and every read is unchanged.

## Order and dependencies

- **Application order: 750, 751, 752, then 760.** The file opens with a check and refuses (nothing changed) without the 750 columns, the 751 column and the 752 trigger.
- **Depends on:** 003 (frameworks, framework_domains, framework_competencies), 395 and 640 (`clinical_review_decision_sod_guard`, `frameworks_sod_publication_guard`), 466 (`trg_cfca_framework_publication_guard`), 660 (`competency_assessment_component`), 750 (`frameworks_layout_guard`), 751 (its F4 body of the SoD guard), 752 (`framework_layout_problem`, `framework_layout_check`, `frameworks_layout_apply_on_publish`).
- **Unchanged (md5 identical before and after, staging):** `cfca_framework_publication_guard` `0590c924...4ba0`, `frameworks_sod_publication_guard` `9f551b00...e83c`, `competency_content_hash` `d00f12ea...0f5a`, `competency_clinically_approved` `8ff94f42...c2c3`, `framework_layout_check` `ad598140...c210`.
- **Redefined:** `frameworks_layout_guard` (750) `b81e09fb...dc40` -> `ad09bad3...314e`, `framework_layout_problem` (752) `e7749326...f5ba3` -> `b097d6d0...41e3`, `frameworks_layout_apply_on_publish` (752) `ef70b948...038d` -> `fed31e63...1ebd`, `clinical_review_decision_sod_guard` (751) `d6b8147c...d30f` -> `c0eec6b4...98c9`. Body diffs at the end.

## What it adds

- `framework_areas` (id, framework_id FK cascade, name 2-120 trimmed, description null or 1-2000, sort_order int not null, created_at, created_by FK profiles set null), unique (framework_id, name). Not in `competency_content_hash`.
- RLS and grants exactly as `framework_domains` (staging, read back): RLS on, one policy `Auth users read areas` SELECT for signed-in users, the Supabase default table grants (anon, authenticated, postgres, service_role). With no write policy only the service role (HQ server) writes.
- `framework_domains.area_id` uuid null FK `framework_areas` on delete set null, plus `framework_domains_area_id_idx`.
- `framework_areas_scope_guard()` with triggers `framework_domains_area_scope` (BEFORE INSERT OR UPDATE OF area_id, framework_id) and `framework_areas_scope` (BEFORE UPDATE OF framework_id): a domain's Area is of its own framework, and an Area never changes framework.
- Layout draft v1 may also carry `areas` (Area ids in order), `domainAreas` {domainId: areaId|null}, `areaNames` {areaId: name}, and a competency may be listed under another domain of the SAME framework (a move, once across all lists). Still refused: another framework's ids, a criterion under another competency, an unknown key. A section change stays inexpressible.
- At publication (same statement, after 466 and 640, as 752): stale check, Area names in two steps (a swap never hits the unique name), domain Areas, competency moves, then dense renumbering of Areas (when named), domains, every named domain AND every domain a competency left, criteria, section order, draft cleared.
- F4: six organisational audit actions join `reorder_layout` as not authorship. `frameworks_sod_publication_guard` is unchanged, so they count as contribution (the mover cannot publish).

## Guarantees kept

| From | Guarantee | How it holds |
|---|---|---|
| 466 | publication only when every competency is approved at its current hash | not changed. `domain_id` and `area_id` are not in the hash (H1), so a move keeps the approval |
| 640 | the publisher is independent of contributors | not changed. Organisational actions are audited on the framework, outside its governance list (R640) |
| 751 | stable outcome ids, organisational edits are not authorship | outcome trigger untouched, SoD guard body = 751 plus six names (F4) |
| 752 | a layout is applied only in the publication statement, whole or not at all | apply stays AFTER ROW, the stale refusal comes before any write (S1), all 760 writes are in the same function (P1, A640) |
| 750 | a layout never names another framework's id or moves a criterion | kept for criteria (L2) and foreign ids (L3). The competency-domain refusal is intentionally lifted by ruling D3 |

**Superseded probes.** VERIFY-752 S1/K2 used "a competency moved to another domain" as the stale example. After 760 that is a valid organisational placement, not stale. VERIFY-760 S1 uses a deleted Area instead.

## Staging (ezhvpgtcqcdsgylrxgdb), 31 Oct 2026, by the agent with the guarded runner

- **PRE:** `cols_750=4 col_751=1 fn_752=3 tbl_760=0 col_760=0 with_layout=0 domains=100 competencies=349`. frameworks triggers = 752 AFTER ROW plus the three BEFORE ROW guards. Children triggers = `framework_competencies_outcome_ids` only. framework_domains RLS on with `Auth users read domains`. md5s as above. `order_fp=a483c7d9...cdb4` (now including each competency's domain), `hash_fp=9ee1991c...0b3` (every competency's content hash).
- **Run 1 and run 2:** both committed (idempotent).
- **VERIFY:** 16/16 ok.
- **Plant-fail:** the same VERIFY with the apply trigger and the area scope trigger disabled: A3, S1, P1 and A640 go FAIL.
- **Post-apply PRECHECK:** only the 760 objects and the four redefined md5s differ. `order_fp` and `hash_fp` unchanged (no row changed).
- **Rollback rehearsal:** `ROLLBACK-760` committed. PRECHECK then equals PRE exactly (every md5, order_fp, hash_fp).
- **Final:** re-applied, VERIFY 16/16 ok again. `framework_areas` grants and policy read back identical to `framework_domains`.

| Check | Proved |
|---|---|
| A1 | Areas create, rename, delete. A 1-character, a padded and a duplicate name refused |
| A2 | a domain set to an Area of its framework |
| A3, A3b | a domain in another framework's Area refused. An Area cannot change framework |
| A4 | deleting an Area leaves its domains with no Area |
| L1 | a published draft with a competency move, domain Areas, Area order and an Area name swap saves, live unchanged, `framework_layout_check` null |
| L2 | a criterion under another competency refused |
| L3 | foreign competency, foreign Area (order and placement), competency under two domains, two Areas with one name, unknown key: all refused |
| S1 | stale draft (deleted Area) refuses the publication whole: the valid move is not applied, version and draft kept |
| P1 | republication as service_role applies move, domain Areas, Area order and swapped names in the statement, renumbers the domain left, clears the draft |
| H1 | every content hash of the framework unchanged by the organisational moves |
| R640 | the person who moved a competency publishing: refused, nothing applied |
| R466 | unapproved CFCA republication: refused, nothing applied |
| A640 | an independent publisher: applied (move and Areas) and cleared, hashes unchanged |
| F4 | the SoD guard lists the six actions after reorder_layout, the publication guard does not |
| T1 | apply AFTER ROW, 466 and 640 BEFORE ROW |

## Production

Not applied. The owner applies it by hand after a separate GO, after 750, 751 and 752, with the OPS-001 safeguards. Post-application: the verification select at the file end (table 1, area_id 1, scope_triggers 2, rls true, areas 0, with_layout 0).

## Function body diffs (source file to 760)

### frameworks_layout_guard

```diff
@@ -8,6 +8,7 @@
   k text;
   x jsonb;
   v_bad integer;
+  v_problem text;
 begin
   -- The section order of this framework: registry codes, each once.
   if new.component_order is not null and (tg_op = 'INSERT' or new.component_order is distinct from old.component_order) then
@@ -32,8 +33,8 @@
     raise exception 'frameworks.layout_draft: a layout draft records who saved it';
   end if;
   if jsonb_typeof(l) <> 'object' or (l -> 'v') is distinct from '1'::jsonb
-     or exists (select 1 from jsonb_object_keys(l) j where j not in ('v', 'domains', 'competencies', 'criteria', 'componentOrder')) then
-    raise exception 'frameworks.layout_draft: not a version 1 layout (keys v, domains, competencies, criteria, componentOrder)';
+     or exists (select 1 from jsonb_object_keys(l) j where j not in ('v', 'domains', 'competencies', 'criteria', 'componentOrder', 'areas', 'domainAreas', 'areaNames')) then
+    raise exception 'frameworks.layout_draft: not a version 1 layout (keys v, domains, competencies, criteria, componentOrder, areas, domainAreas, areaNames)';
   end if;
 
   -- Domains: this framework own, each once.
@@ -50,7 +51,8 @@
     end if;
   end if;
 
-  -- Competencies: under their own domain only (moving one to another domain is a clinical change).
+  -- Competencies: of this framework, under a domain of this framework. Another domain of the same framework is an
+  -- organisational move (760, ruling D3). Another framework is refused.
   if l ? 'competencies' then
     if jsonb_typeof(l -> 'competencies') <> 'object' then
       raise exception 'frameworks.layout_draft: competencies maps a domain id to a list of its competency ids';
@@ -63,10 +65,11 @@
         raise exception 'frameworks.layout_draft: competencies maps a domain of this framework to a list of competency ids';
       end if;
       select count(*) - count(distinct e) + count(*) filter (where not exists (
-               select 1 from framework_competencies c where c.id = (e #>> '{}')::uuid and c.domain_id = k::uuid))
+               select 1 from framework_competencies c join framework_domains d on d.id = c.domain_id
+                where c.id = (e #>> '{}')::uuid and d.framework_id = new.id))
         into v_bad from jsonb_array_elements(x) e;
       if v_bad > 0 then
-        raise exception 'frameworks.layout_draft: a competency is repeated or is not in that domain. Moving a competency to another domain is a clinical change';
+        raise exception 'frameworks.layout_draft: a competency is repeated or is not of this framework';
       end if;
     end loop;
   end if;
@@ -105,6 +108,12 @@
       raise exception 'frameworks.layout_draft: a section is repeated or is not in the component registry';
     end if;
   end if;
+
+  -- 760: Areas, domain Areas, Area names and a competency listed twice, by the rules of framework_layout_problem.
+  v_problem := public.framework_layout_problem(new.id, l);
+  if v_problem is not null then
+    raise exception 'frameworks.layout_draft: %', v_problem;
+  end if;
   return new;
 end;
 $$;
```

### clinical_review_decision_sod_guard

```diff
@@ -33,7 +33,7 @@
          and coalesce(a.action, '') not in ('submit_review', 'approve_content', 'reject_content', 'publish', 'archive', 'revert',
            'catalogue_entry_add', 'catalogue_entry_status', 'catalogue_entry_remove', 'catalogue_entry_review',
            'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added', 'clinical_scope_ended', 'framework_specialty_set',
-           'reorder_layout'));
+           'reorder_layout', 'create_area', 'rename_area', 'delete_area', 'reorder_areas', 'set_domain_area', 'move_competency_domain'));
   elsif not v_conflict and v.content_kind = 'case' then
     v_conflict := exists (select 1 from case_library_version cv
       where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)
```

### frameworks_layout_apply_on_publish

```diff
@@ -9,6 +9,7 @@
   v_problem text;
   k text;
   v_codes text[];
+  v_left uuid[] := '{}';
 begin
   -- Defence in depth (the WHEN clause already says so): only a publication with a pending layout.
   if l is null or new.pub_status is distinct from 'published'
@@ -23,6 +24,44 @@
     raise exception 'framework layout at publication: the pending layout is out of date, %. Nothing was published and the layout draft is kept. Discard it or save the layout again, then put the framework forward again', v_problem;
   end if;
 
+  -- 760: Area names, in two steps so that a swap of two names never meets the unique name half way.
+  if l ? 'areaNames' then
+    update framework_areas a set name = a.id::text
+      from jsonb_each_text(l -> 'areaNames') n(id, nm)
+     where a.id = n.id::uuid and a.framework_id = new.id and a.name is distinct from btrim(n.nm);
+    update framework_areas a set name = btrim(n.nm)
+      from jsonb_each_text(l -> 'areaNames') n(id, nm)
+     where a.id = n.id::uuid and a.framework_id = new.id and a.name is distinct from btrim(n.nm);
+  end if;
+
+  -- 760: the Area of each named domain.
+  if l ? 'domainAreas' then
+    update framework_domains d set area_id = case when jsonb_typeof(m.value) = 'null' then null else (m.value #>> '{}')::uuid end
+      from jsonb_each(l -> 'domainAreas') m
+     where d.id = m.key::uuid and d.framework_id = new.id
+       and d.area_id is distinct from (case when jsonb_typeof(m.value) = 'null' then null else (m.value #>> '{}')::uuid end);
+  end if;
+
+  -- 760: a competency listed under another domain of this framework moves there. The domains it left are renumbered.
+  if l ? 'competencies' then
+    select coalesce(array_agg(distinct c.domain_id), '{}') into v_left
+      from framework_competencies c
+      join (select m.key::uuid as domain_id, e::uuid as id from jsonb_each(l -> 'competencies') m, jsonb_array_elements_text(m.value) e) t on t.id = c.id
+     where c.domain_id <> t.domain_id;
+    update framework_competencies c set domain_id = t.domain_id
+      from (select m.key::uuid as domain_id, e::uuid as id from jsonb_each(l -> 'competencies') m, jsonb_array_elements_text(m.value) e) t
+     where c.id = t.id and c.domain_id <> t.domain_id;
+  end if;
+
+  if l ? 'areas' then
+    update framework_areas a set sort_order = r.rn
+      from (select fa.id, row_number() over (order by n.ord nulls last, fa.sort_order, fa.name, fa.id)::int as rn
+              from framework_areas fa
+              left join jsonb_array_elements_text(l -> 'areas') with ordinality n(id, ord) on n.id::uuid = fa.id
+             where fa.framework_id = new.id) r
+     where a.id = r.id and a.sort_order is distinct from r.rn;
+  end if;
+
   if l ? 'domains' then
     update framework_domains d set sort_order = r.rn
       from (select fd.id, row_number() over (order by n.ord nulls last, fd.sort_order nulls last, fd.name, fd.id)::int as rn
@@ -33,7 +72,7 @@
   end if;
 
   if l ? 'competencies' then
-    for k in select jsonb_object_keys(l -> 'competencies') loop
+    for k in select jsonb_object_keys(l -> 'competencies') union select unnest(v_left)::text loop
       update framework_competencies c set sort_order = r.rn
         from (select fc.id, row_number() over (order by n.ord nulls last, fc.sort_order nulls last, fc.name, fc.id)::int as rn
                 from framework_competencies fc
```

### framework_layout_problem

```diff
@@ -14,7 +14,7 @@
     return null;
   end if;
   if jsonb_typeof(l) <> 'object' or (l -> 'v') is distinct from '1'::jsonb
-     or exists (select 1 from jsonb_object_keys(l) j where j not in ('v', 'domains', 'competencies', 'criteria', 'componentOrder')) then
+     or exists (select 1 from jsonb_object_keys(l) j where j not in ('v', 'domains', 'competencies', 'criteria', 'componentOrder', 'areas', 'domainAreas', 'areaNames')) then
     return 'it is not a version 1 layout';
   end if;
 
@@ -32,6 +32,8 @@
     end if;
   end if;
 
+  -- Competencies: a domain of this framework to competencies of this framework. One listed under another domain of
+  -- the same framework is moved there (organisational, ruling D3). Each is listed once across all domains.
   if l ? 'competencies' then
     if jsonb_typeof(l -> 'competencies') <> 'object' then
       return 'its competencies are not a map of domain to competency ids';
@@ -45,13 +47,14 @@
         return 'a domain it orders competencies in is no longer in this framework';
       end if;
       if exists (select 1 from jsonb_array_elements_text(x) e
-                  where not exists (select 1 from framework_competencies c where c.id = e::uuid and c.domain_id = k::uuid)) then
-        return 'a competency it names is no longer in that domain';
-      end if;
-      if (select count(*) - count(distinct e) from jsonb_array_elements_text(x) e) > 0 then
-        return 'a competency is named twice';
+                  where not exists (select 1 from framework_competencies c join framework_domains d on d.id = c.domain_id
+                                     where c.id = e::uuid and d.framework_id = p_framework)) then
+        return 'a competency it names is no longer in this framework';
       end if;
     end loop;
+    if (select count(*) - count(distinct e) from jsonb_each(l -> 'competencies') m, jsonb_array_elements_text(m.value) e) > 0 then
+      return 'a competency is named twice';
+    end if;
   end if;
 
   if l ? 'criteria' then
@@ -90,6 +93,56 @@
       return 'a section is named twice';
     end if;
   end if;
+
+  -- Areas (760): this framework own, each once.
+  if l ? 'areas' then
+    if jsonb_typeof(l -> 'areas') <> 'array'
+       or exists (select 1 from jsonb_array_elements(l -> 'areas') e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ uuid_re) then
+      return 'its areas are not a list of Area ids';
+    end if;
+    if exists (select 1 from jsonb_array_elements_text(l -> 'areas') e
+                where not exists (select 1 from framework_areas a where a.id = e::uuid and a.framework_id = p_framework)) then
+      return 'an Area it names is no longer in this framework';
+    end if;
+    if (select count(*) - count(distinct e) from jsonb_array_elements_text(l -> 'areas') e) > 0 then
+      return 'an Area is named twice';
+    end if;
+  end if;
+
+  -- The Area of a domain (760): a domain of this framework to an Area of this framework, or null.
+  if l ? 'domainAreas' then
+    if jsonb_typeof(l -> 'domainAreas') <> 'object'
+       or exists (select 1 from jsonb_each(l -> 'domainAreas') m where m.key !~ uuid_re
+                    or (jsonb_typeof(m.value) <> 'null' and (jsonb_typeof(m.value) <> 'string' or (m.value #>> '{}') !~ uuid_re))) then
+      return 'its domain Areas are not a map of domain id to Area id or null';
+    end if;
+    if exists (select 1 from jsonb_each(l -> 'domainAreas') m
+                where not exists (select 1 from framework_domains d where d.id = m.key::uuid and d.framework_id = p_framework)) then
+      return 'a domain it places in an Area is no longer in this framework';
+    end if;
+    if exists (select 1 from jsonb_each(l -> 'domainAreas') m where jsonb_typeof(m.value) = 'string'
+                 and not exists (select 1 from framework_areas a where a.id = (m.value #>> '{}')::uuid and a.framework_id = p_framework)) then
+      return 'an Area it places a domain in is no longer in this framework';
+    end if;
+  end if;
+
+  -- New Area names (760): an Area of this framework to a name of 2 to 120 characters, and no two Areas end up with
+  -- the same name.
+  if l ? 'areaNames' then
+    if jsonb_typeof(l -> 'areaNames') <> 'object'
+       or exists (select 1 from jsonb_each(l -> 'areaNames') m where m.key !~ uuid_re or jsonb_typeof(m.value) <> 'string'
+                    or char_length(btrim(m.value #>> '{}')) not between 2 and 120) then
+      return 'its Area names are not a map of Area id to a name of 2 to 120 characters';
+    end if;
+    if exists (select 1 from jsonb_each(l -> 'areaNames') m
+                where not exists (select 1 from framework_areas a where a.id = m.key::uuid and a.framework_id = p_framework)) then
+      return 'an Area it renames is no longer in this framework';
+    end if;
+    if (select count(*) - count(distinct nm) from (
+          select coalesce(btrim(l -> 'areaNames' ->> a.id::text), a.name) as nm from framework_areas a where a.framework_id = p_framework) z) > 0 then
+      return 'two Areas would have the same name';
+    end if;
+  end if;
   return null;
 end;
 $$;
```

