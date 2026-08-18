-- CPR-PD-009 s5 and s6 - the incident lifecycle and severity model the module specification defines.
--
-- WHY THIS CHANGES A VOCABULARY THAT WAS ONLY JUST WRITTEN
--
-- Migration 315 built mos_incident from CPR-CORE-MOS-001 s8, whose field table gives status as
-- "open / acknowledged / investigating / monitoring / resolved" and severity as a "configured incident
-- severity". CPR-PD-009 - the module specification for Support and Incidents - defines both properly
-- and differently: EIGHT lifecycle states in s5, and SEV-1 to SEV-4 plus Informational in s6.
--
-- They are not reconcilable by mapping. s5's DECLARED and MITIGATING and POST-INCIDENT have no
-- equivalent in the shorter list, and collapsing them would lose the distinction between an incident
-- being investigated and one being actively mitigated - which is the difference between "we are looking"
-- and "we are doing something", and the thing a commander is asked about most.
--
-- CPR-CORE-MOS-001 s19 decides which wins: "Product Director specifications remain target-state
-- requirements unless formally changed". So s8's list was a sketch of a field, s5 is the operating
-- model, and the substrate moves to it before anything is built on the sketch.
--
-- NOTE  THIS IS SAFE ONLY BECAUSE THE TABLE IS EMPTY. mos_incident holds no rows - the acceptance fixtures
-- were removed by migration 316 - so there is nothing to migrate and no risk of a row being stranded
-- outside the new vocabulary. A later change to these lists will not have that luxury and will need a
-- backfill written before the constraint is swapped.

alter table mos_incident drop constraint if exists mos_incident_severity_check;
alter table mos_incident drop constraint if exists mos_incident_status_check;
alter table mos_incident drop constraint if exists mos_incident_resolved_at_matches_status;

-- s6. Machine codes rather than display names, because "SEV-1 Critical" is a label and sev1 is an
-- identifier. The label belongs in the view layer where it can be translated.
alter table mos_incident
  add constraint mos_incident_severity_check
  check (severity in ('sev1', 'sev2', 'sev3', 'sev4', 'informational'));

-- s5's eight states, in lifecycle order
alter table mos_incident
  add constraint mos_incident_status_check
  check (status in ('detected', 'declared', 'investigating', 'mitigating',
                    'monitoring', 'resolved', 'post_incident', 'closed'));

alter table mos_incident alter column status set default 'detected';

-- NOTE  THE RESOLUTION TIME NOW COVERS THREE STATES, NOT ONE. s5 continues past RESOLVED into POST-INCIDENT
-- and CLOSED, and an incident does not become unresolved by moving into its postmortem. The old
-- constraint said resolved_at is present exactly when status is 'resolved', which under s5 would strip
-- the recovery time from every incident that went on to a postmortem.
alter table mos_incident
  add constraint mos_incident_resolved_at_matches_status
  check ((status in ('resolved', 'post_incident', 'closed')) = (resolved_at is not null));

-- s5: "State transitions require actor/time and audit." The trail already carries actor and time. This
-- records WHY, which s5 requires by name for a severity change and which a status change deserves too.
alter table mos_incident_event add column if not exists reason text;

comment on column mos_incident_event.reason is
  'CPR-PD-009 s5 - why the state or severity changed. Required by the specification for a severity change and recorded for every transition.';

-- s5 again: severity may change as impact becomes clearer, and the change belongs on the timeline.
alter table mos_incident_event add column if not exists from_severity text;
alter table mos_incident_event add column if not exists to_severity text;

notify pgrst, 'reload schema';
