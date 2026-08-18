import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-010 §9 — WHAT FALLS INSIDE CLINICAL SAFETY SCOPE, and whether a mitigation is present.
//
// §9 defines its scope by consequence: "features whose failure, MISLEADING BEHAVIOR or AUTOMATION could
// plausibly influence clinical care or practitioner decisions", and names examples — "medication safety
// warnings, clinical decision-support/AI outputs, clinical workflow data integrity, encounter signing
// and critical patient-related calculations".
//
// Every one of those categories has a counterpart in this product, and each already carries a
// deliberate safety mitigation built during the clinical spine work. That is worth surfacing: a
// clinical safety governance page over a product with real mitigations and no hazard records says
// something quite specific, and it is not "nothing here".
//
// ⚠ EVERY CLAIM BELOW IS CHECKED, NOT REMEMBERED. Each entry names a marker that must be present in the
// source, and the page reports what it finds. I know what these mitigations do because I helped build
// them, and that is exactly why the page must not take my word for it — a remembered safety property is
// the kind of claim that stays on a screen long after the code stopped doing it.
//
// ⚠ AND PRESENCE IS NOT VERIFICATION. A marker proves the mitigation EXISTS. Whether it works is a
// safety verification with evidence behind it, which §9 requires and this product has none of. The page
// says so; migration 327 refuses to let a hazard read "verified" without evidence.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type SafetyScopeItem = {
  key: string;
  /** The §9 example category this answers to. */
  category: string;
  label: string;
  /** What could go wrong. §9's "hazard" in ordinary words. */
  hazard: string;
  /** The mitigation this product already carries, stated so a reader can check it. */
  mitigation: string;
  /** Where the marker was looked for, and whether it was found. */
  source: string;
  present: boolean;
};

export type SafetyScope = { items: SafetyScopeItem[]; found: number; missing: number } | null;

/**
 * §9's scope, as this product implements it.
 *
 * ⚠ THE LIST COMES FROM §9's OWN EXAMPLES, NOT FROM MY VIEW OF WHAT IS RISKY. Choosing which features
 * are clinically significant is a safety judgement, and inventing one would be the same error as
 * inventing a risk score. §9 names five categories; these are this product's counterparts to them.
 */
const SCOPE: Omit<SafetyScopeItem, "present">[] = [
  {
    key: "ai_output",
    category: "Clinical decision support / AI output",
    label: "AI clinical assistant",
    hazard: "A model originates a clinical fact — a diagnosis, drug or dose — that no record supports, and a practitioner acts on it.",
    mitigation: "Every task requires a consultation to ground it, and there is no ungrounded mode. Nothing the assistant produces reaches the clinical record.",
    source: "src/lib/practice/ai-assistant.ts :: consultation",
  },
  {
    key: "encounter_signing",
    category: "Encounter signing",
    label: "Signed encounter immutability",
    hazard: "A signed encounter is altered afterwards, so the record no longer says what the clinician attested to.",
    mitigation: "A database trigger refuses the write. The guard is in the schema rather than the engine, so it survives every future code path.",
    source: "supabase/migrations :: trg_practice_encounter_signed_guard",
  },
  {
    key: "note_versioning",
    category: "Clinical workflow data integrity",
    label: "Clinical note versioning",
    hazard: "A note is edited in place, so \"what did this say when it was signed\" becomes unanswerable.",
    mitigation: "Note versions are append-only and refused an UPDATE at the database.",
    source: "supabase/migrations :: trg_practice_note_version_immutable",
  },
  {
    key: "laterality",
    category: "Critical patient-related detail",
    label: "Procedure laterality",
    hazard: "A sided procedure is recorded without a side. Wrong-site surgery is the canonical never-event.",
    mitigation: "A procedure whose catalogue entry is marked sided is refused without left, right or bilateral — and \"not applicable\" is refused too, because it is the get-past-the-field answer.",
    source: "src/lib/practice/procedures.ts :: laterality",
  },
  {
    key: "consent",
    category: "Critical patient-related detail",
    label: "Procedure consent default",
    hazard: "Consent defaults to obtained, manufacturing a legal claim about a conversation nobody can evidence.",
    mitigation: "Consent defaults to not_recorded and never to obtained. A patient declining is separately recordable, because refusal is a real clinical fact.",
    source: "src/lib/practice/procedures.ts :: not_recorded",
  },
  {
    key: "followup_overdue",
    category: "Clinical workflow data integrity",
    label: "Follow-up overdue derivation",
    hazard: "Overdue is stored and set by a job. If the job does not run, nothing is overdue — so the screen that exists to say \"these people are waiting on you\" goes quietest exactly when a practice has been least attentive.",
    mitigation: "Overdue is derived from the due date at read time, in the practice's own timezone. Status holds only human decisions.",
    source: "src/lib/practice/follow-ups.ts :: overdue",
  },
];

export function loadSafetyScope(root = process.cwd()): SafetyScope {
  try {
    const items: SafetyScopeItem[] = SCOPE.map(s => {
      const [path, needle] = s.source.split(" :: ");
      const target = join(root, path);
      let present = false;
      try {
        if (!existsSync(target)) {
          present = false;
        } else if (readdirSync(root).length && path.endsWith("migrations")) {
          present = readdirSync(target)
            .filter(f => f.endsWith(".sql"))
            .some(f => readFileSync(join(target, f), "utf8").includes(needle));
        } else {
          present = readFileSync(target, "utf8").includes(needle);
        }
      } catch {
        present = false;
      }
      return { ...s, present };
    });

    // ⚠ A TOTAL FAILURE TO READ IS null, NOT "nothing present". If the source tree is absent from a
    // deployed bundle every marker would report missing, and the page would announce that this product
    // carries no clinical safety mitigations at all — which would be both false and alarming.
    if (items.every(i => !i.present)) return null;

    return {
      items,
      found: items.filter(i => i.present).length,
      missing: items.filter(i => !i.present).length,
    };
  } catch {
    return null;
  }
}
