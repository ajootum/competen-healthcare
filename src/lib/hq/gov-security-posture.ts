import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-010 §8 — SECURITY POSTURE FACTS, derived from the product's own source.
//
// §8 names nine review domains: "authentication, authorization, encryption, secrets, session management,
// tenancy isolation, auditability, backups/continuity and third-party dependencies." Four of them have
// something checkable in this repository. Five do not, and saying which is which is the point.
//
// ⚠ §8 ALSO SAYS "DO NOT TURN THIS PAGE INTO A SOC", AND THAT SHAPES WHAT IS COUNTED.
//
// These are POSTURE STATISTICS — how many tables carry a policy, how many trails are append-only. They
// are not a vulnerability feed and not a live detection surface. Product Health owns detection.
//
// ⚠ AND THE SPECIFIC LIST IS RESTRICTED DETAIL, DELIBERATELY NOT RETURNED.
//
// "209 tables rely on application-layer guards" is a governance posture. "Here are the 209" is a map of
// where to look, and §8 requires sensitive detail to be restricted to authorised security roles.
// Migration 327 built gov_security_restricted_detail as a SEPARATE TABLE for exactly this, so the
// specific names belong there behind their own capability rather than in a payload the overview,
// search, exports and payload logs all carry. This module returns counts and never names.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type SecurityFact = {
  domain: string;
  label: string;
  /** The checkable figure, or null when this domain has nothing derivable from source. */
  value: string | null;
  reading: string;
  /** Why no figure exists, for the domains where none can. */
  absent?: string;
};

export type SecurityPosture = { facts: SecurityFact[]; derivable: number; total: number } | null;

export function loadSecurityPosture(root = process.cwd()): SecurityPosture {
  try {
    const dir = join(root, "supabase", "migrations");
    const files = readdirSync(dir).filter(f => f.endsWith(".sql"));
    if (files.length === 0) return null;

    let sql = "";
    for (const f of files) sql += readFileSync(join(dir, f), "utf8") + "\n";
    const code = sql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");

    const rlsOn = new Set([...code.matchAll(/alter table (\w+) enable row level security/gi)]
      .map(m => m[1].toLowerCase()));
    const withPolicy = new Set([...code.matchAll(/create policy[\s\S]{0,120}?on (\w+)/gi)]
      .map(m => m[1].toLowerCase()));
    const practiceRls = [...rlsOn].filter(t => /^(practice_|mos_)/.test(t));
    const practiceNoPolicy = practiceRls.filter(t => !withPolicy.has(t)).length;

    const appendOnly = new Set([...code.matchAll(/create\s+or\s+replace\s+function\s+(\w*immutable\w*)/gi)]
      .map(m => m[1])).size;

    let deps = 0;
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      deps = Object.keys(pkg.dependencies ?? {}).length;
    } catch { deps = 0; }

    const facts: SecurityFact[] = [
      {
        domain: "tenancy_isolation", label: "Tenancy isolation",
        value: `${practiceNoPolicy} of ${practiceRls.length}`,
        reading:
          "Practice-plane tables with row-level security ENABLED and no policy defined. Row-level "
          + "security with no policy denies anon and authenticated access outright — and the service "
          + "role bypasses it. So tenancy isolation on these tables rests entirely on application-layer "
          + "guards, not on the database. That is a posture, not a defect, and it is precisely the "
          + "question §8 asks this domain to review.",
      },
      {
        domain: "auditability", label: "Auditability",
        value: String(appendOnly),
        reading:
          "Append-only trails enforced at the database — records an UPDATE or DELETE cannot touch, "
          + "with the cascade allowance that keeps a parent deletable.",
      },
      {
        domain: "third_party", label: "Third-party dependencies",
        value: String(deps),
        reading:
          "Direct runtime dependencies. A small surface, but §16 asks for criticality, continuity and "
          + "assurance evidence per provider and none of that is recorded.",
      },
      {
        domain: "authorization", label: "Authorization",
        value: null,
        reading: "The capability model is real and enforced on every HQ page and route.",
        absent:
          "What is missing is the REVIEW: §8 asks for a security review of the authorization model with "
          + "an owner and a posture, and none has been recorded. The model existing is not the same as "
          + "somebody having examined it.",
      },
      {
        domain: "authentication", label: "Authentication",
        value: null, reading: "",
        absent:
          "Enforcement decisions were taken during the security arc — second factor, idle timeout, "
          + "lockout behaviour — but they live in operational configuration rather than in a governance "
          + "review with an owner, a date and a posture.",
      },
      {
        domain: "session_management", label: "Session management",
        value: null, reading: "",
        absent: "Configured operationally. No governance review recorded.",
      },
      {
        domain: "encryption", label: "Encryption",
        value: null, reading: "",
        absent:
          "Provided by the hosting platform and not expressible from this repository. §8 asks for a "
          + "review of it, which is an assurance activity rather than a code property.",
      },
      {
        domain: "secrets", label: "Secrets",
        value: null, reading: "",
        absent:
          "⚠ Deliberately not counted. Enumerating secret names or their locations on a governance "
          + "overview is the kind of detail §8 restricts to authorised security roles, and a count "
          + "invites the follow-up question that produces the list.",
      },
      {
        domain: "backup_continuity", label: "Backups and continuity",
        value: null, reading: "",
        absent:
          "Platform-provided. §8 asks for a review of restore capability, which is a rehearsal with "
          + "evidence rather than anything readable from source.",
      },
    ];

    return { facts, derivable: facts.filter(f => f.value !== null).length, total: facts.length };
  } catch {
    return null;
  }
}
