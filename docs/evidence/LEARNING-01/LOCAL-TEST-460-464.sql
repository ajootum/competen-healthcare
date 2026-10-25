-- Local planted-failure test of 460-464 on a throwaway Postgres (stubs + real 370, 395, 399, 422, 442 s4).
-- Every refusal is asserted by its message, and every allowed act after it, so a check cannot pass vacuously.
\set ON_ERROR_STOP 1
create or replace function t_fail(p_sql text, p_needle text, p_name text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_needle in sqlerrm) > 0 then raise notice 'PASS  %', p_name; return; end if;
    raise exception 'FAIL  % -- refused for the wrong reason: %', p_name, sqlerrm;
  end;
  raise exception 'FAIL  % -- was accepted', p_name;
end $f$;
create or replace function t_ok(p_cond boolean, p_name text) returns void language plpgsql as $f$
begin
  if p_cond then raise notice 'PASS  %', p_name; else raise exception 'FAIL  %', p_name; end if;
end $f$;

do $t$
declare
  author uuid := gen_random_uuid(); reviewer uuid := gen_random_uuid(); publisher uuid := gen_random_uuid();
  pricer uuid := gen_random_uuid(); issuer_p uuid := gen_random_uuid(); learner uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  fw uuid; dom uuid; comp uuid; office uuid; appt uuid;
  prov uuid; ext_prov uuid; off uuid; ext_off uuid; v1 uuid; v2 uuid; ev uuid; ccv uuid; auth uuid; rec uuid; rec2 uuid; price uuid; price2 uuid; co uuid; ent uuid;
  free_off uuid; fv uuid; frec uuid;
begin
  insert into profiles(id, full_name) values (author, 'A'), (reviewer, 'R'), (publisher, 'P'), (pricer, 'PR'), (issuer_p, 'I'), (learner, 'L'), (other, 'O');
  insert into frameworks(code, name) values ('CF-T', 'Test framework') returning id into fw;
  insert into framework_domains(framework_id, name) values (fw, 'Cardiac') returning id into dom;
  insert into framework_competencies(domain_id, code, name, learning_outcomes) values (dom, 'C1', 'ECG', '["Identify sinus rhythm"]') returning id into comp;
  insert into ogs_offices(office_type) values ('hq_learning') returning id into office;
  insert into ogs_office_appointments(office_id, person_id, role, status) values (office, reviewer, 'clinical_content_reviewer', 'active') returning id into appt;
  insert into clinical_reviewer_scope(appointment_id, scope_kind, scope_ref) values (appt, 'framework', fw);

  -- 460
  insert into learning_provider(code, name, kind) values ('COMPETEN', 'Competen Holdings', 'competen') returning id into prov;
  insert into learning_provider(code, name, kind, website_url) values ('EXT-ACME', 'Acme Learning', 'external', 'https://acme.example') returning id into ext_prov;
  perform t_fail(format($s$update learning_provider set kind = 'partner' where id = %L$s$, prov), 'cannot be rewritten', 'P1 a provider kind is frozen');
  perform t_fail($s$insert into learning_offering(code, title, source, delivery, offering_type) values ('LRN-X1', 'Bad', 'external', 'hosted', 'course')$s$, 'learning_offering_check', 'O1 an external offering cannot be hosted');
  insert into learning_offering(code, title, source, delivery, offering_type, created_by) values ('LRN-ECG-01', 'ECG Interpretation', 'competen', 'hosted', 'course', author) returning id into off;
  perform t_fail(format($s$insert into learning_offering_version(offering_id, version_no, content, review_route, authored_by) values (%L, 1, '{}', 'listing', array[%L]::uuid[])$s$, off, author), 'hosted learning is clinically reviewed', 'V1 hosted learning cannot take the listing route');
  insert into learning_offering_version(offering_id, version_no, content, review_route, authored_by, content_owner_id, delivery_provider_id, certificate_issuer_id, commercial_provider_id)
    values (off, 1, jsonb_build_object('schema', 'learning-blueprint/1', 'level', 'foundation', 'format', 'self_paced', 'durationMinutes', 90, 'access', jsonb_build_object('model', 'paid'),
      'audience', jsonb_build_object('professionTermIds', jsonb_build_array(gen_random_uuid()::text, 'not-a-uuid')), 'topics', jsonb_build_array('ECG', 'cardiac'), 'certificate', jsonb_build_object('offered', true)),
      'clinical', array[author], prov, prov, prov, prov) returning id into v1;
  perform t_ok((select content_hash <> 'computed-by-trigger' and level = 'foundation' and duration_minutes = 90 and access_model = 'paid' and cardinality(profession_term_ids) = 1 and topics = array['ECG', 'cardiac'] from learning_offering_version where id = v1), 'V2 the database computes the hash and the filter columns, dropping a malformed id');
  perform t_fail(format($s$select learning_offering_submit(%L, %L, 1)$s$, v1, author), 'name the CFCA competencies', 'S1 the clinical route needs CFCA outcomes');
  insert into learning_offering_version_outcome(version_id, competency_id, outcome_index, relation, objective_key) values (v1, comp, 0, 'develops', 'obj-1'), (v1, comp, -1, 'assesses', 'obj-2');
  perform t_fail(format($s$insert into learning_offering_version_outcome(version_id, competency_id, relation, objective_key) values (%L, %L, 'verifies', 'obj-3')$s$, v1, comp), 'learning_offering_version_outcome_check', 'M1 an unknown relation is refused');
  perform t_fail(format($s$select learning_offering_submit(%L, %L, 1)$s$, v1, publisher), 'only an author or editor', 'S2 only an author submits');
  ccv := learning_offering_submit(v1, author, 1);
  perform t_ok(ccv is not null and (select content_kind = 'learning' and content_hash = (select content_hash from learning_offering_version where id = v1) from clinical_content_version where id = ccv), 'S3 submission puts the exact hash forward as kind learning');
  perform t_fail(format($s$update learning_offering_version set content = '{"a":1}' where id = %L$s$, v1), 'only a draft is edited directly', 'S4 a submitted version is frozen');
  perform t_fail(format($s$delete from learning_offering_version_outcome where version_id = %L$s$, v1), 'cannot change', 'S5 its outcomes are frozen');
  perform t_fail(format($s$select learning_offering_publish(%L, %L)$s$, v1, publisher), 'not clinically approved', 'R0 an unapproved version cannot be published');
  perform t_fail(format($s$insert into clinical_review_decision(version_id, reviewer_id, appointment_id, decision) values (%L, %L, %L, 'approved')$s$, ccv, author, appt), 'not independent', 'R1 the author cannot review');
  insert into clinical_review_decision(version_id, reviewer_id, appointment_id, decision) values (ccv, reviewer, appt, 'approved');
  perform t_ok(learning_offering_approved(v1), 'R2 one in-scope independent approval approves the exact version');
  perform t_fail(format($s$select learning_offering_publish(%L, %L)$s$, v1, author), 'not independent', 'U1 an author cannot publish');
  perform t_fail(format($s$select learning_offering_record_x(%L)$s$, v1), 'does not exist', 'U0 control: an unknown function is refused');
  perform learning_offering_publish(v1, publisher);
  perform t_ok(learning_offering_deliverable(v1), 'U2 published and approved is deliverable');

  -- External listing: listing route, no 395 record, listing approval by someone else.
  insert into learning_offering(code, title, source, delivery, offering_type) values ('LRN-EXT-ACLS', 'ACLS (Acme)', 'external', 'external', 'course') returning id into ext_off;
  insert into learning_offering_version(offering_id, version_no, content, review_route, authored_by, content_owner_id, delivery_provider_id, commercial_provider_id)
    values (ext_off, 1, jsonb_build_object('external', jsonb_build_object('url', 'http://insecure.example'), 'access', jsonb_build_object('model', 'external')), 'listing', array[author], ext_prov, ext_prov, ext_prov) returning id into ev;
  perform t_fail(format($s$select learning_offering_submit(%L, %L, 1)$s$, ev, author), 'secure (https) link', 'X1 an external listing needs an https link (http is dropped)');
  update learning_offering_version set content = jsonb_build_object('external', jsonb_build_object('url', 'https://acme.example/acls', 'reviewDueOn', '2027-04-01'), 'access', jsonb_build_object('model', 'external')) where id = ev;
  perform t_ok(learning_offering_submit(ev, author, 1) is null and not exists (select 1 from clinical_content_version where learning_version_id = ev), 'X2 the listing route writes no clinical review record');
  perform t_fail(format($s$insert into clinical_content_version (content_kind, learning_version_id, content_hash, content_snapshot, authored_by, submitted_by) values ('learning', %L, 'x', '{}', array[%L]::uuid[], %L)$s$, ev, author, author), 'only as a submitted version on the clinical route', 'X3 a listing cannot be put into clinical review');
  perform learning_offering_publish(ev, publisher);
  perform t_ok(learning_offering_deliverable(ev) and not learning_offering_approved(ev), 'X4 a published listing is deliverable and is NOT clinically approved');

  -- 462: the record
  perform t_fail(format($s$insert into learning_record(user_id, offering_id, version_id, delivery, access_kind) values (%L, %L, %L, 'hosted', 'free')$s$, learner, off, v1), 'not free', 'E1 a paid version is not enrolled on free');
  insert into learning_offering(code, title, source, delivery, offering_type) values ('LRN-FREE-01', 'Free intro', 'competen', 'hosted', 'module') returning id into free_off;
  insert into learning_offering_version(offering_id, version_no, content, review_route, authored_by, content_owner_id, delivery_provider_id) values (free_off, 1, '{"access":{"model":"free"}}', 'clinical', array[author], prov, prov) returning id into fv;
  perform t_fail(format($s$insert into learning_record(user_id, offering_id, version_id, delivery, access_kind) values (%L, %L, %L, 'hosted', 'free')$s$, learner, free_off, fv), 'only a published, approved version', 'E2 a draft is never enrolled on');
  insert into learning_record(user_id, offering_id, version_id, delivery, access_kind) values (learner, ext_off, ev, 'external', 'external') returning id into rec2;
  perform t_ok((select evidence_class = 'self_declared' from learning_record where id = rec2), 'E3 an external record is self-declared until a document is attached');
  perform t_fail(format($s$update learning_record set status = 'completed', completed_at = now(), completion_kind = 'course_completion' where id = %L$s$, rec2), 'learning_record_check', 'E4 an external record cannot claim hosted course completion');
  update learning_record set status = 'completed', completed_at = now(), completion_kind = 'external_completion', external_completed_on = current_date, external_hours = 8,
    document_path = learner::text || '/cert.pdf', document_name = 'cert.pdf', document_mime = 'application/pdf', document_bytes = 1000 where id = rec2;
  perform t_ok((select evidence_class = 'source_linked' from learning_record where id = rec2), 'E5 a document makes it source-linked, never verified');
  perform t_fail(format($s$update learning_record set document_path = %L where id = %L$s$, other::text || '/x.pdf', rec2), 'learning_record_document_whole', 'E6 a document path must be the owner''s own');
  perform t_fail(format($s$update learning_record set status = 'in_progress', completed_at = null, completion_kind = null where id = %L$s$, rec2), 'stays completed', 'E7 a completed record stays completed');
  perform t_fail(format($s$delete from learning_record where id = %L$s$, rec2), 'is kept', 'E8 a record is never deleted');

  -- 463: price, checkout, entitlement
  insert into ogs_office_appointments(office_id, person_id, role, status) values (office, pricer, 'learning_price_approver', 'active'), (office, issuer_p, 'learning_certificate_issuer', 'active');
  insert into learning_offering_price(offering_id, currency, amount_minor, access_days, terms_version, proposed_by) values (off, 'UGX', 25000, 365, 'learning-terms/1', author) returning id into price;
  perform t_fail(format($s$update learning_offering_price set state = 'approved', decided_by = %L, decided_at = now() where id = %L$s$, pricer, price), 'only through its functions', 'C1 a price is not approved by a direct write');
  perform t_fail(format($s$select learning_offering_price_decide(%L, %L, true, null)$s$, price, author), 'not independent', 'C2 the proposer cannot approve');
  perform t_fail(format($s$select learning_offering_price_decide(%L, %L, true, null)$s$, price, publisher), 'not authorised', 'C3 someone without hq.learning.price.approve cannot approve');
  perform learning_offering_price_decide(price, pricer, true, null);
  perform t_fail(format($s$update learning_offering_price set amount_minor = 1 where id = %L$s$, price), 'cannot be rewritten', 'C4 an approved price cannot be rewritten');
  perform t_fail(format($s$insert into individual_checkout(user_id, item_kind, offering_id, offering_price_id, amount_minor, currency, interval_days, terms_version, operating_entity, tx_ref) values (%L, 'course', %L, %L, 100, 'UGX', 365, 'learning-terms/1', 'competen_holdings', 'cin-t1')$s$, learner, off, price), 'copies its approved price exactly', 'K1 a course checkout cannot change the price');
  perform t_fail(format($s$insert into individual_checkout(user_id, item_kind, offering_id, offering_price_id, plan_code, amount_minor, currency, interval_days, terms_version, operating_entity, tx_ref) values (%L, 'course', %L, %L, 'p', 25000, 'UGX', 365, 'learning-terms/1', 'competen_holdings', 'cin-t2')$s$, learner, off, price), 'individual_checkout_subject_check', 'K2 a course checkout is not also an experience checkout');
  insert into individual_checkout(user_id, item_kind, offering_id, offering_price_id, amount_minor, currency, interval_days, terms_version, operating_entity, tx_ref)
    values (learner, 'course', off, price, 25000, 'UGX', 365, 'learning-terms/1', 'competen_holdings', 'cin-t3') returning id into co;
  perform t_fail(format($s$update individual_checkout set amount_minor = 1 where id = %L$s$, co), 'cannot be rewritten', 'K3 what a course checkout bought cannot be rewritten');
  update individual_checkout set status = 'paid', settled_at = now() where id = co;
  perform t_ok(true, 'K4 settlement may still mark it paid');
  perform t_fail(format($s$insert into individual_course_entitlement(user_id, offering_id, source) values (%L, %L, 'payment')$s$, learner, off), 'individual_course_entitlement_check', 'N1 a payment entitlement needs its checkout and price');
  insert into individual_course_entitlement(user_id, offering_id, price_id, checkout_id, source, terms_version, ends_at) values (learner, off, price, co, 'payment', 'learning-terms/1', now() + interval '365 days') returning id into ent;
  perform t_fail(format($s$insert into individual_course_entitlement(user_id, offering_id, price_id, checkout_id, source, terms_version) values (%L, %L, %L, %L, 'payment', 'learning-terms/1')$s$, learner, off, price, co), 'ux_individual_course_entitlement_checkout', 'N2 one checkout opens one entitlement (idempotent)');
  perform t_fail(format($s$insert into learning_record(user_id, offering_id, version_id, delivery, access_kind, course_entitlement_id) values (%L, %L, %L, 'hosted', 'entitlement', %L)$s$, other, off, v1, ent), 'live course entitlement of this person', 'N3 someone else cannot enrol on my entitlement');
  insert into learning_record(user_id, offering_id, version_id, delivery, access_kind, course_entitlement_id) values (learner, off, v1, 'hosted', 'entitlement', ent) returning id into rec;
  insert into learning_record_activity(record_id, user_id, activity_key, kind) values (rec, learner, 'l1', 'lesson');
  insert into learning_record_activity(record_id, user_id, activity_key, kind, score, max_score, passed) values (rec, learner, 'q1', 'check', 4, 5, true);
  perform t_fail(format($s$insert into learning_record_activity(record_id, user_id, activity_key, kind) values (%L, %L, 'l2', 'lesson')$s$, rec, other), 'learning_record_activity_record_fk', 'A1 progress cannot be written to another person''s record');
  update learning_record set status = 'completed', completed_at = now(), completion_kind = 'course_completion', completion_basis = '{"lessons":1}' where id = rec;

  -- certificates
  perform t_fail(format($s$insert into learning_certificate(certificate_no, verification_code, record_id, user_id, offering_id, version_id, outcome, issuer_provider_id, authorisation_id, snapshot) values ('LC-AAAA-BBBB-CCCC', 'abcdefghijklmnopqrstuvwx', %L, %L, %L, %L, 'course_completion', %L, gen_random_uuid(), '{}')$s$, rec, learner, off, v1, prov), 'no live issuer authorisation', 'Z1 no certificate without an authorisation');
  perform t_fail(format($s$insert into learning_certificate_authorisation(version_id, issuer_provider_id, outcomes, authorised_by) values (%L, %L, array['course_completion'], %L)$s$, v1, prov, author), 'not independent', 'Z2 an author cannot authorise certificates');
  perform t_fail(format($s$insert into learning_certificate_authorisation(version_id, issuer_provider_id, outcomes, authorised_by) values (%L, %L, array['course_completion'], %L)$s$, v1, prov, publisher), 'not authorised', 'Z3 someone without hq.learning.certificate.issue cannot');
  perform t_fail(format($s$insert into learning_certificate_authorisation(version_id, issuer_provider_id, outcomes, authorised_by) values (%L, %L, array['verified_competence'], %L)$s$, v1, prov, issuer_p), 'learning_certificate_authorisation_check', 'Z4 verified competence is never a certificate outcome');
  insert into learning_certificate_authorisation(version_id, issuer_provider_id, outcomes, authorised_by) values (v1, prov, array['course_completion', 'assessed_knowledge'], issuer_p) returning id into auth;
  perform t_fail(format($s$insert into learning_certificate(certificate_no, verification_code, record_id, user_id, offering_id, version_id, outcome, issuer_provider_id, authorisation_id, snapshot) values ('LC-AAAA-BBBB-CCCD', 'abcdefghijklmnopqrstuvwy', %L, %L, %L, %L, 'assessed_knowledge', %L, %L, '{}')$s$, rec, learner, off, v1, prov, auth), 'assessed knowledge is certified only', 'Z5 assessed knowledge needs a record completed as assessed knowledge');
  insert into learning_certificate(certificate_no, verification_code, record_id, user_id, offering_id, version_id, outcome, issuer_provider_id, authorisation_id, snapshot)
    values ('LC-AAAA-BBBB-CCCE', 'abcdefghijklmnopqrstuvwz', rec, learner, off, v1, 'course_completion', prov, auth, '{"course":"ECG"}');
  perform t_fail($s$update learning_certificate set snapshot = '{}' where certificate_no = 'LC-AAAA-BBBB-CCCE'$s$, 'cannot change', 'Z6 a certificate cannot change');
  update learning_certificate set revoked_at = now(), revoked_by = issuer_p, revoked_reason = 'test revocation' where certificate_no = 'LC-AAAA-BBBB-CCCE';
  perform t_ok(true, 'Z7 it can be revoked, once');

  -- history outlives access
  update individual_course_entitlement set status = 'cancelled' where id = ent;
  perform t_ok(exists (select 1 from learning_record where id = rec and status = 'completed'), 'H1 ending access keeps the completed record');
  perform t_fail(format($s$delete from individual_course_entitlement where id = %L$s$, ent), 'is the record', 'H2 an entitlement is never deleted');
  perform t_fail(format($s$update individual_course_entitlement set status = 'active' where id = %L$s$, ent), 'stays cancelled', 'H3 a cancelled entitlement stays cancelled');
  perform t_ok(not exists (select 1 from individual_live_course_entitlement where id = ent), 'H4 the live view drops it');

  -- 399 unchanged for experiences
  insert into individual_plan(plan_code, experience_code, name, active, amount_minor, currency, interval_days) values ('pro_test', 'professional', 'Pro', true, 1000, 'UGX', 30);
  insert into individual_checkout(user_id, plan_code, experience_code, amount_minor, currency, interval_days, tx_ref) values (learner, 'pro_test', 'professional', 1000, 'UGX', 30, 'cin-t4');
  perform t_ok(true, 'K5 an experience checkout is written exactly as 399 wrote it');
  perform t_fail(format($s$insert into individual_checkout(user_id, plan_code, experience_code, amount_minor, currency, tx_ref) values (%L, 'pro_test', 'professional', 1000, 'UGX', 'cin-t5')$s$, learner), 'individual_checkout_subject_check', 'K6 an experience checkout still needs its period');

  -- 461 kept the other kinds
  perform t_ok((select pg_get_constraintdef(oid) like '%resource%' and pg_get_constraintdef(oid) like '%learning%' and pg_get_constraintdef(oid) like '%case%' from pg_constraint where conname = 'clinical_content_version_subject_check'), 'G1 the subject CHECK keeps competency, case and resource and adds learning');

  -- 464
  perform t_ok((select count(*) = 8 from hq_position_capability where position_code like 'learning\_%') and not exists (select 1 from hq_position_capability where capability_code like 'hq.learning.course.%' and position_code not like 'learning\_%'), 'Q1 eight grants, all to the four new positions');
  raise notice 'ALL ASSERTIONS PASSED';
end
$t$;
-- NULL-trap controls (a CHECK passes when it evaluates to NULL): every nullable column in an exactly-one CHECK.
do $n$
declare u uuid; o uuid; p uuid;
begin
  select id into u from profiles limit 1; select id into o from learning_offering where code = 'LRN-ECG-01'; select id into p from learning_offering_price where state = 'approved' limit 1;
  perform t_fail(format($s$insert into individual_checkout(user_id, item_kind, offering_id, offering_price_id, amount_minor, currency, interval_days, operating_entity, tx_ref) values (%L, 'course', %L, %L, 25000, 'UGX', 365, 'competen_holdings', 'cin-n1')$s$, u, o, p), 'individual_checkout_subject_check', 'NT1 a course checkout without its terms version');
  perform t_fail(format($s$insert into individual_checkout(user_id, item_kind, offering_id, offering_price_id, amount_minor, currency, interval_days, terms_version, tx_ref) values (%L, 'course', %L, %L, 25000, 'UGX', 365, 'learning-terms/1', 'cin-n2')$s$, u, o, p), 'individual_checkout_subject_check', 'NT2 a course checkout without its operating entity');
  raise notice 'NULL-TRAP CONTROLS PASSED';
end $n$;
-- Regression: the replaced guards still review a competency and a case exactly as 395 and 422 did.
do $g$
declare a uuid := gen_random_uuid(); r uuid; c uuid; appt uuid; ccv uuid; kase uuid; cv uuid; ccv2 uuid;
begin
  select person_id, id into r, appt from ogs_office_appointments where role = 'clinical_content_reviewer' limit 1;
  select id into c from framework_competencies limit 1;
  insert into profiles(id) values (a);
  insert into clinical_content_version(competency_id, content_hash, content_snapshot, authored_by, submitted_by) values (c, 'x', '{}', array[a], a) returning id into ccv;
  perform t_ok((select content_kind = 'competency' and content_hash = competency_content_hash(c) from clinical_content_version where id = ccv), 'G2 a competency version is hashed by the database as before');
  insert into clinical_review_decision(version_id, reviewer_id, appointment_id, decision) values (ccv, r, appt, 'approved');
  perform t_ok(true, 'G3 an in-scope competency approval is accepted');
  insert into case_library_case(code, title) values ('CASE-REG-1', 'Regression') returning id into kase;
  insert into case_library_version(case_id, version_no, content, authored_by) values (kase, 1, '{"t":1}', array[a]) returning id into cv;
  insert into case_library_version_competency(version_id, competency_id) values (cv, c);
  ccv2 := case_library_submit(cv, a, 1);
  insert into clinical_review_decision(version_id, reviewer_id, appointment_id, decision) values (ccv2, r, appt, 'approved');
  perform t_ok(case_library_approved(cv), 'G4 a case is still submitted, reviewed and approved through 422');
  raise notice 'REGRESSION PASSED';
end $g$;
-- Account deletion: a learner's records cascade away past their guards, and governance actors never block deletion.
do $d$
declare l uuid; a uuid; n0 int; n1 int;
begin
  select user_id into l from learning_certificate limit 1;
  select proposed_by into a from learning_offering_price limit 1;
  select count(*) into n0 from learning_record where user_id = l;
  perform t_ok(n0 > 0, 'D0 control: the learner has records to delete');
  delete from profiles where id = l;
  select count(*) into n1 from learning_record where user_id = l;
  perform t_ok(n1 = 0 and not exists (select 1 from learning_certificate where user_id = l) and not exists (select 1 from individual_course_entitlement where user_id = l), 'D1 deleting a person removes their record, certificates and entitlements by cascade');
  delete from profiles where id = a;
  perform t_ok(exists (select 1 from learning_offering_price where proposed_by = a), 'D2 deleting a price proposer is not blocked, and the price record stays');
  raise notice 'DELETION PASSED';
end $d$;
