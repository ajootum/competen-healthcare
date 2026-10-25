import { describe, it, expect } from "vitest";
import { EXPERIENCES, EXPERIENCE_KEYS, FOUNDATION_NAV, SCHOLAR, BOTTOM_BAR_MAX, bottomNavFor, experienceHref, isExperienceKey, navFor } from "./experiences";
import { latestDecisions, credentialEvidence, type IndividualPassport } from "./passport";
import { buildHistory } from "./history";
import { cleanQuestion, recordContext, systemPrompt, QUESTION_MAX } from "./assistant";

// The Individual foundation's pure parts: the registry, the Passport view, the shared history and the
// personal AI's prompt. COMPETEN-IND-003 s2(2)-(6).


describe("experience registry", () => {
  it("has exactly the two experiences of COMPETEN-IND-001 D2, with text-safe accents", () => {
    expect([...EXPERIENCE_KEYS]).toEqual(["scholar", "professional"]);
    expect(EXPERIENCES.scholar.operatingEntity).toBe("scholar_operator");
    expect(EXPERIENCES.professional.operatingEntity).toBe("competen_holdings");
  });

  it("gives both experiences the SAME foundation navigation -- shared modules, not copies", () => {
    expect(FOUNDATION_NAV.map(n => n.module)).toEqual(["home", "assistant", "passport", "profile", "settings"]);
    expect(experienceHref("scholar", "passport")).toBe("/individual/scholar/passport");
    expect(experienceHref("professional")).toBe("/individual/professional");
  });

  // ⚠ The governed empty state: what is not built has a reason, and never reads as "coming soon".
  it("gives every planned capability a specific reason, and never says 'coming soon'", () => {
    for (const k of EXPERIENCE_KEYS) {
      expect(EXPERIENCES[k].planned.length).toBeGreaterThan(0);
      for (const p of EXPERIENCES[k].planned) {
        expect(p.reason.length).toBeGreaterThan(30);
        expect(`${p.reason} ${p.summary}`.toLowerCase()).not.toContain("coming soon");
      }
    }
  });

  it("composes navigation: Home, the experience's own modules, then the foundation; the bar caps at five without Settings", () => {
    const saved = [...SCHOLAR.modules];
    try {
      // Replace, not append: the test fixes its own module list, whatever Scholar actually ships.
      SCHOLAR.modules.splice(0, SCHOLAR.modules.length,
        { key: "study", segment: "study", label: "Study", short: "Study", icon: "S", bottom: true },
        { key: "rev", segment: "revision", label: "Revision", short: "Rev", icon: "R", bottom: true },
        { key: "cases", segment: "cases", label: "Cases", short: "Cases", icon: "C" },
      );
      expect(navFor("scholar").map(n => n.segment)).toEqual(["", "study", "revision", "cases", "assistant", "passport", "profile", "settings"]);
      const bar = bottomNavFor("scholar").map(n => n.segment);
      expect(bar).toEqual(["", "study", "revision", "assistant", "passport"]);
      expect(bar.length).toBeLessThanOrEqual(BOTTOM_BAR_MAX);
      expect(bar).not.toContain("settings");
      // The other experience is untouched by Scholar's modules.
      // (Professional has its own modules since IND-007, so assert the absence of Scholar's rather than a fixed list.)
      expect(navFor("professional").map(n => n.segment).filter(s => ["study", "revision", "cases"].includes(s))).toEqual([]);
    } finally {
      SCHOLAR.modules.splice(0, SCHOLAR.modules.length, ...saved);
    }
  });

  it("validates experience keys", () => {
    expect(isExperienceKey("scholar")).toBe(true);
    expect(isExperienceKey("practice")).toBe(false);
    expect(isExperienceKey(undefined)).toBe(false);
  });
});

describe("Passport view", () => {
  const rows = [
    { competency_id: "c1", outcome: "competent", expiry_date: "2027-01-01", created_at: "2026-05-01", hospital_id: "h1", framework_competencies: { name: "IV cannulation" } },
    { competency_id: "c1", outcome: "not_yet_competent", expiry_date: null, created_at: "2026-01-01", hospital_id: "h1", framework_competencies: { name: "IV cannulation" } },
    { competency_id: "c2", outcome: "competent", expiry_date: "2026-01-01", created_at: "2025-01-01", framework_competencies: [{ name: "BLS" }] },
  ];

  it("keeps the latest decision per competency and applies /verify's current rule", () => {
    const out = latestDecisions(rows, "2026-10-22", r => (r.hospital_id === "h1" ? "Mulago" : null));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: "IV cannulation", outcome: "competent", current: true, issuer: "Mulago" });
    expect(out[1]).toMatchObject({ name: "BLS", current: false, issuer: null });
  });

  it("labels a credential verified only when an organisation verified it", () => {
    expect(credentialEvidence({ verified: true })).toBe("institution_verified");
    expect(credentialEvidence({ verified: false })).toBe("self_declared");
    expect(credentialEvidence({})).toBe("self_declared");
  });
});

describe("development history", () => {
  const passport: IndividualPassport = {
    competencies: [{ competencyId: "c1", name: "BLS", outcome: "competent", expiryDate: null, decidedAt: "2026-03-01T10:00:00Z", issuer: "Mulago", current: true }],
    credentials: [
      { title: "RN licence", type: "professional_license", issuingBody: "UNMC", issueDate: "2025-06-01", expiryDate: null, status: "active", evidence: "institution_verified" },
      { title: "Undated cert", type: "cpd_certificate", issuingBody: null, issueDate: null, expiryDate: null, status: "active", evidence: "self_declared" },
    ],
    employment: [],
    own: [],
    study: { ok: true, data: [] },
    evaluations: { ok: true, data: [] },
  };

  // Graduation adds, never replaces: both experience periods stay on the one timeline.
  it("keeps every experience period on one timeline, newest first, and drops undated facts", () => {
    const h = buildHistory({
      joinedAt: "2024-09-01T00:00:00Z",
      entitlements: [
        { experience_code: "scholar", status: "active", starts_at: "2024-09-01T00:00:00Z", ends_at: null, source: "pilot" },
        { experience_code: "professional", status: "active", starts_at: "2026-07-01T00:00:00Z", ends_at: null, source: "graduation" },
      ],
      passport,
    });
    expect(h.map(e => e.date)).toEqual(["2026-07-01", "2026-03-01", "2025-06-01", "2024-09-01", "2024-09-01"]);
    expect(h[0]).toMatchObject({ title: "Competen Professional started", detail: "activated on graduation" });
    expect(h.find(e => e.title === "Undated cert")).toBeUndefined();
    expect(h.at(-2)?.title).toBe("Joined Competen Individual");
  });

  it("survives unreadable sections without inventing entries", () => {
    expect(buildHistory({ joinedAt: null, entitlements: null, passport: { competencies: null, credentials: null, employment: null, own: null, study: { ok: true, data: [] }, evaluations: { ok: true, data: [] } } })).toEqual([]);
  });
});

describe("personal AI prompt", () => {
  it("speaks with a different persona per experience over the same rules", () => {
    expect(systemPrompt("scholar")).toContain("Competen Scholar");
    expect(systemPrompt("professional")).toContain("Competen Professional");
    for (const k of EXPERIENCE_KEYS) expect(systemPrompt(k)).toContain("This conversation is not saved");
  });

  it("says when a section could not be read instead of presenting it as empty", () => {
    const ctx = recordContext({ name: "Amina", experience: "scholar", live: ["scholar"], passport: { competencies: null, credentials: [], employment: null, own: null, study: { ok: true, data: [] }, evaluations: { ok: true, data: [] } } });
    expect(ctx).toContain("Assessed competencies: could not be read");
    expect(ctx).toContain("Credentials on record: none.");
    expect(ctx).toContain("Records they added themselves in Competen Professional: could not be read");
  });

  it("rejects empty and oversized questions", () => {
    expect(cleanQuestion("  ")).toBeNull();
    expect(cleanQuestion(42)).toBeNull();
    expect(cleanQuestion("x".repeat(QUESTION_MAX + 1))).toBeNull();
    expect(cleanQuestion("  What next?  ")).toBe("What next?");
  });
});
