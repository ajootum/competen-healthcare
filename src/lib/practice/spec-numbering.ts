// THE CPR NUMBERING DECISION (CPR-BUILD-001 s1), settled here so it cannot drift back into ambiguity.
//
// THE PROBLEM. Two specification sets both call themselves CPR and both use three digits, and the same
// string means different things in each. Writing the colliding ids out here would corrupt this file the
// next time anyone runs a re-key over the tree -- which is not a hypothetical, it happened while this
// file was being written -- so the collisions are stated as a table of numbers instead:
//
//     000   V2: architecture / module list          v1.0: Enterprise Architecture
//     010   V2: Follow-up                           v1.0: Workspace Experience & UI System
//     020   V2: Navigation & Application Shell      v1.0: Workflow & Orchestration Engine
//
// A bare three-digit CPR id in a comment or a traceability array is therefore unreadable without knowing
// which document the author had open. That is not a naming quibble: `src/lib/marketing/practice-content.ts`
// tags every public capability area with these ids and a harness asserts coverage against them, so an
// ambiguous id turns a real traceability assertion into a meaningless one that keeps printing PASS.
//
// THE DECISION: option (b) of CPR-BUILD-001 s1, with the namespacing from option (a) applied to make it
// safe. The division of labour is (b)'s --
//
//     the PUBLIC pages keep tracing to the V2 workspace documents, which is what they were written from;
//     the APPLICATION modules trace to the v1.0 set, which is what the product is now built from
//
// -- but the old set is RE-KEYED to the `CPR-V2-` prefix everywhere, because (b) on its own scopes the
// collision rather than removing it, and "you can tell which scheme this is from context" is exactly the
// kind of rule that survives until the first person who lacks the context.
//
// THE RULE, IN ONE LINE: a bare three-digit CPR id is always the v1.0 set. The V2 set always carries the
// `CPR-V2-` prefix. scripts/practice-content-harness.ts asserts this over the source tree, so a bare
// old-set id cannot be reintroduced by a copy-paste from an older file.
//
// Named documents (CPR-ARCH-001, CPR-IAM-001, CPR-PROV-001, CPR-SHELL-001, CPR-FLOW-001, CPR-DM-001,
// CPR-LP-001, CPR-GATE-001, CPR-BUILD-000/001) carry no number in either sequence and are untouched.

const v1 = (n: number) => `CPR-${String(n).padStart(3, "0")}`;

/**
 * The twenty V2 workspace surfaces, plus a twenty-first that is named in an architecture document and was
 * never specified. Ids only, deliberately: the codebase cites these documents by number in several places
 * and disagrees with itself about two of the titles, so writing titles here would be inventing an
 * authority this file does not have. The documents hold the titles.
 */
export const V2_WORKSPACES = Array.from({ length: 21 }, (_, i) => `CPR-V2-${String(i + 1).padStart(3, "0")}`);

/** The V2 surfaces the public catalogue is asserted to cover. The twenty-first was never specified. */
export const V2_SPECIFIED_WORKSPACES = V2_WORKSPACES.slice(0, 20);

export type V1Domain =
  | "Foundation" | "Clinical Care" | "Practice Intelligence" | "Practice Operations" | "Enterprise Services";
export type V1Module = { id: string; title: string; domain: V1Domain };

/**
 * The thirty-seven v1.0 developer specifications (CPR-BUILD-001 s2). This is the list an application
 * module cites, and the list a new module's id is checked against -- a typo'd 135 is then a failing
 * assertion rather than a plausible-looking comment.
 *
 * Ids are COMPUTED from their number rather than written as literals, for the reason in the header: a
 * tree-wide re-key of the old scheme must not be able to reach into the register that defines the new one.
 */
export const V1_MODULES: V1Module[] = [
  { id: v1(0), title: "Enterprise Architecture", domain: "Foundation" },
  { id: v1(10), title: "Workspace Experience & UI System", domain: "Foundation" },
  { id: v1(20), title: "Workflow & Orchestration Engine", domain: "Foundation" },
  { id: v1(30), title: "Enterprise Data Architecture", domain: "Foundation" },
  { id: v1(40), title: "Practice Design System", domain: "Foundation" },

  { id: v1(100), title: "Patient Management", domain: "Clinical Care" },
  { id: v1(110), title: "Appointment & Scheduling Management", domain: "Clinical Care" },
  { id: v1(120), title: "Encounter Management", domain: "Clinical Care" },
  { id: v1(130), title: "Clinical Documentation", domain: "Clinical Care" },
  { id: v1(140), title: "Follow-up Management", domain: "Clinical Care" },
  { id: v1(150), title: "Procedure & Clinical Activity", domain: "Clinical Care" },

  { id: v1(200), title: "Practice Intelligence", domain: "Practice Intelligence" },
  { id: v1(210), title: "AI Clinical Assistant", domain: "Practice Intelligence" },
  { id: v1(220), title: "Case Memory", domain: "Practice Intelligence" },
  { id: v1(230), title: "Clinical Reflection", domain: "Practice Intelligence" },
  { id: v1(240), title: "Professional Portfolio", domain: "Practice Intelligence" },
  { id: v1(250), title: "Competency & CPD", domain: "Practice Intelligence" },
  { id: v1(260), title: "Knowledge Management", domain: "Practice Intelligence" },
  { id: v1(270), title: "Analytics & Reporting", domain: "Practice Intelligence" },

  { id: v1(300), title: "Operations Home", domain: "Practice Operations" },
  { id: v1(310), title: "Team & Delegated Access", domain: "Practice Operations" },
  { id: v1(320), title: "Communication & Document Management", domain: "Practice Operations" },
  { id: v1(330), title: "Reports, Documents & Correspondence", domain: "Practice Operations" },
  { id: v1(340), title: "Tasks, Reminders & Notifications", domain: "Practice Operations" },
  { id: v1(350), title: "Search & Global Retrieval", domain: "Practice Operations" },
  { id: v1(360), title: "Configuration & Personalisation", domain: "Practice Operations" },
  { id: v1(370), title: "Security, Privacy & Practitioner Control", domain: "Practice Operations" },

  { id: v1(400), title: "Integration & Interoperability", domain: "Enterprise Services" },
  { id: v1(410), title: "Mobile & Offline", domain: "Enterprise Services" },
  { id: v1(420), title: "AI Automation & Workflow Engine", domain: "Enterprise Services" },
  { id: v1(430), title: "API & Developer Platform", domain: "Enterprise Services" },
  { id: v1(440), title: "Billing, Subscription & Licensing", domain: "Enterprise Services" },
  { id: v1(450), title: "Deployment, Provisioning & Tenant Lifecycle", domain: "Enterprise Services" },
  { id: v1(460), title: "Monitoring & Observability", domain: "Enterprise Services" },
  { id: v1(470), title: "Business Continuity & DR", domain: "Enterprise Services" },
  { id: v1(480), title: "Enterprise Administration", domain: "Enterprise Services" },
  { id: v1(490), title: "Roadmap & Release Governance", domain: "Enterprise Services" },
];

export const V1_IDS = V1_MODULES.map(m => m.id);

export const v1Title = (id: string) => V1_MODULES.find(m => m.id === id)?.title ?? null;

/** True for a string shaped like a v1.0 module id that is not one. Catches typo'd citations. */
export function isUnknownV1Id(id: string): boolean {
  return /^CPR-\d{3}$/.test(id) && !V1_IDS.includes(id);
}
