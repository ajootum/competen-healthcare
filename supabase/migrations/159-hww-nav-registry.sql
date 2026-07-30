-- 159: HWW-UI-001 role-adaptive navigation - register the Healthcare Worker Workspace navigation
-- sections and modules in the Configuration Registry (WCE-002) so they become configurable objects in
-- the EXISTING super-admin Designer/Registry surfaces: a hospital can disable, rename or reorder any
-- sidebar entry through governed configuration, with no deployment.
--
-- The catalogue itself lives in code (src/lib/hww/navigation.ts) per the WCE convention - these rows are
-- the REGISTRY entries that make each object discoverable and configurable; workspace_config_overrides
-- carries the sparse per-scope settings. Runtime never depends on these rows: with no registry and no
-- overrides the sidebar renders its catalogue defaults unchanged.
--
-- object_key = 'workspace.<config_path>' (the runtime strips the 'workspace.' prefix), matching the
-- convention already used by the WCE catalogue. on conflict do nothing keeps re-runs safe and never
-- clobbers tenant edits. Plain idempotent statements only (no do-blocks).

insert into configuration_registry_objects
  (object_key, object_type, display_name, description, parent_object_key, status, configurability_class,
   safety_classification, override_policy, default_enabled, configuration_owner, route, allowed_config_levels,
   display_order, source)
values
  ('workspace.healthcare-worker', 'WORKSPACE', 'Healthcare Worker Workspace', 'Bedside clinical operations workspace', null, 'active', 'mandatory_configurable', 'clinical_support', 'restricted', true, 'PLATFORM', '/healthcare-worker', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 0, 'catalogue'),

  ('workspace.healthcare-worker.shift', 'NAVIGATION_SECTION', 'Shift', 'Shift-centred operational modules', 'workspace.healthcare-worker', 'active', 'mandatory_configurable', 'clinical_support', 'restricted', true, 'PLATFORM', null, '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 100, 'catalogue'),
  ('workspace.healthcare-worker.clinical', 'NAVIGATION_SECTION', 'Clinical', 'Assessment and escalation modules', 'workspace.healthcare-worker', 'active', 'mandatory_configurable', 'clinical_safety_relevant', 'restricted', true, 'PLATFORM', null, '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 200, 'catalogue'),
  ('workspace.healthcare-worker.communication', 'NAVIGATION_SECTION', 'Communication', 'Team communication modules', 'workspace.healthcare-worker', 'active', 'optional', 'operational', 'full', true, 'PLATFORM', null, '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 300, 'catalogue'),
  ('workspace.healthcare-worker.quality', 'NAVIGATION_SECTION', 'Quality Events', 'Incident and concern reporting', 'workspace.healthcare-worker', 'active', 'mandatory_configurable', 'clinical_safety_relevant', 'restricted', true, 'PLATFORM', null, '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 400, 'catalogue'),
  ('workspace.healthcare-worker.intelligence', 'NAVIGATION_SECTION', 'Intelligence', 'AI advisory modules', 'workspace.healthcare-worker', 'active', 'optional', 'clinical_support', 'full', true, 'PLATFORM', null, '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 500, 'catalogue'),
  ('workspace.healthcare-worker.tools', 'NAVIGATION_SECTION', 'Tools', 'Reports and settings', 'workspace.healthcare-worker', 'active', 'optional', 'non_clinical', 'full', true, 'PLATFORM', null, '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 600, 'catalogue'),

  ('workspace.healthcare-worker.home', 'MODULE', 'Home (Shift Dashboard)', 'Shift command centre landing view', 'workspace.healthcare-worker', 'active', 'mandatory_locked', 'clinical_support', 'local_display_only', true, 'PLATFORM', '/healthcare-worker', '["PLATFORM"]', 10, 'catalogue'),

  ('workspace.healthcare-worker.shift.my-patients', 'MODULE', 'My Patients', 'Primary operational patient workspace', 'workspace.healthcare-worker.shift', 'active', 'mandatory_locked', 'clinical_safety_relevant', 'local_display_only', true, 'PLATFORM', '/healthcare-worker/patients', '["PLATFORM"]', 100, 'catalogue'),
  ('workspace.healthcare-worker.shift.my-tasks', 'MODULE', 'My Tasks', 'Nursing task list', 'workspace.healthcare-worker.shift', 'active', 'mandatory_configurable', 'clinical_support', 'restricted', true, 'PLATFORM', '/healthcare-worker/tasks', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 110, 'catalogue'),
  ('workspace.healthcare-worker.shift.medication-schedule', 'MODULE', 'Medication Schedule', 'Operational medication coordination', 'workspace.healthcare-worker.shift', 'active', 'mandatory_configurable', 'clinical_safety_critical', 'restricted', true, 'PLATFORM', '/healthcare-worker/medications', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 120, 'catalogue'),
  ('workspace.healthcare-worker.shift.assignment-inbox', 'MODULE', 'Assignment Inbox', 'Assignment and transfer acceptance', 'workspace.healthcare-worker.shift', 'active', 'mandatory_locked', 'clinical_safety_relevant', 'local_display_only', true, 'PLATFORM', '/healthcare-worker/inbox', '["PLATFORM"]', 130, 'catalogue'),
  ('workspace.healthcare-worker.shift.handover', 'MODULE', 'Handover', 'SBAR handover and responsibility transfer', 'workspace.healthcare-worker.shift', 'active', 'mandatory_configurable', 'clinical_safety_relevant', 'restricted', true, 'PLATFORM', '/healthcare-worker/handover', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 140, 'catalogue'),

  ('workspace.healthcare-worker.clinical.observations', 'MODULE', 'Observations & PEWS', 'Observation queue and deterioration tracking', 'workspace.healthcare-worker.clinical', 'active', 'mandatory_configurable', 'clinical_safety_critical', 'restricted', true, 'PLATFORM', '/healthcare-worker/observations', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 200, 'catalogue'),
  ('workspace.healthcare-worker.clinical.acuity', 'MODULE', 'Acuity Assessment', 'Ward PEWS / ICU CIAF acuity capture', 'workspace.healthcare-worker.clinical', 'active', 'mandatory_configurable', 'clinical_safety_critical', 'restricted', true, 'PLATFORM', '/healthcare-worker/acuity', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 210, 'catalogue'),
  ('workspace.healthcare-worker.clinical.workload', 'MODULE', 'Workload Assessment', 'Ward workload / ICU NAS capture', 'workspace.healthcare-worker.clinical', 'active', 'mandatory_configurable', 'clinical_support', 'restricted', true, 'PLATFORM', '/healthcare-worker/workload', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 220, 'catalogue'),
  ('workspace.healthcare-worker.clinical.escalations', 'MODULE', 'Escalations', 'Safety alerts and clinical escalation', 'workspace.healthcare-worker.clinical', 'active', 'mandatory_locked', 'clinical_safety_critical', 'local_display_only', true, 'PLATFORM', '/healthcare-worker/safety', '["PLATFORM"]', 230, 'catalogue'),
  ('workspace.healthcare-worker.clinical.procedures', 'MODULE', 'Procedures', 'Procedure capture (planned)', 'workspace.healthcare-worker.clinical', 'draft', 'optional', 'clinical_support', 'full', true, 'PLATFORM', null, '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 240, 'catalogue'),

  ('workspace.healthcare-worker.communication.messages', 'MODULE', 'Messages', 'Ward channels and patient-context messaging', 'workspace.healthcare-worker.communication', 'active', 'optional', 'operational', 'full', true, 'PLATFORM', '/healthcare-worker/communication', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 300, 'catalogue'),
  ('workspace.healthcare-worker.communication.announcements', 'MODULE', 'Unit Announcements', 'Broadcasts with acknowledgement', 'workspace.healthcare-worker.communication', 'active', 'optional', 'operational', 'full', true, 'PLATFORM', '/healthcare-worker/communication', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 310, 'catalogue'),

  ('workspace.healthcare-worker.quality.incidents', 'MODULE', 'Incidents', 'Frontline incident reporting', 'workspace.healthcare-worker.quality', 'active', 'mandatory_locked', 'clinical_safety_critical', 'local_display_only', true, 'PLATFORM', '/healthcare-worker/safety', '["PLATFORM"]', 400, 'catalogue'),
  ('workspace.healthcare-worker.quality.concerns', 'MODULE', 'Nurse Concerns', 'Structured bedside concern capture', 'workspace.healthcare-worker.quality', 'active', 'mandatory_configurable', 'clinical_safety_relevant', 'restricted', true, 'PLATFORM', '/healthcare-worker/concerns', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 410, 'catalogue'),

  ('workspace.healthcare-worker.intelligence.copilot', 'MODULE', 'AI Copilot', 'Advisory bedside clinical copilot', 'workspace.healthcare-worker.intelligence', 'active', 'optional', 'clinical_support', 'full', true, 'PLATFORM', '/healthcare-worker/copilot', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 500, 'catalogue'),

  ('workspace.healthcare-worker.tools.reports', 'MODULE', 'Reports', 'Shift summary and personal contribution', 'workspace.healthcare-worker.tools', 'active', 'optional', 'non_clinical', 'full', true, 'PLATFORM', '/healthcare-worker/shift-summary', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE"]', 600, 'catalogue'),
  ('workspace.healthcare-worker.tools.settings', 'MODULE', 'Settings', 'Personal preferences', 'workspace.healthcare-worker.tools', 'active', 'user_personalisable', 'non_clinical', 'full', true, 'USER', '/dashboard/preferences', '["PLATFORM","TENANT","HOSPITAL","UNIT","ROLE","USER"]', 610, 'catalogue')
on conflict (object_key) do nothing;

notify pgrst, 'reload schema';
