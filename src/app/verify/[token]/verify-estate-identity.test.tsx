/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// IND-003 condition D for COMPETEN-IND-007: an ESTATE-minted /verify link renders byte-identically to the
// page before IND-007 (frozen at src/test-fixtures/verify-page-d6252ad6.tsx). Only a link with an
// individual_professional_share companion row, while the release gate is on, may show anything new --
// and what it shows never uses verified wording for the person's own records.

type Rows = Record<string, any>;
let rows: Rows = {};

/** A chainable stand-in for the service-role client: every builder method returns the builder, and the
 *  terminal awaits resolve to the canned rows for that table. */
function client() {
  return {
    from(table: string) {
      const result = () => {
        const v = rows[table];
        return { data: typeof v === "function" ? v() : v ?? null, error: null, count: 0 };
      };
      const b: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (res: any, rej: any) => Promise.resolve(result()).then(res, rej);
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(result());
          return () => b;
        },
      });
      return b;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => client() }));
vi.mock("@/lib/competency/framework-currency", () => ({
  loadFrameworkCurrency: async () => new Map(),
  assessCurrency: () => ({ state: "current" }),
  summariseCurrency: (v: unknown[]) => ({ total: v.length, caveated: 0, unstamped: 0, superseded: 0, retired: 0, unknown: 0 }),
}));

const SHARE = { id: "11111111-1111-4111-8111-111111111111", nurse_id: "22222222-2222-4222-8222-222222222222", scope: "full", label: "Job application",
  expires_at: "2099-01-01T00:00:00Z", consent: true, revoked: false, created_at: "2026-10-01T00:00:00Z", view_count: 3 };

function estateData(extra: Rows = {}): Rows {
  return {
    passport_share_tokens: SHARE,
    profiles: { full_name: "Amina Nakato", role: "nurse", roles: null, specialization: "Midwifery", hospital_id: null },
    competency_decisions: [{ competency_id: "c1", outcome: "competent", expiry_date: "2099-01-01", created_at: "2026-01-01", framework_id: "f1", framework_version: 1, framework_competencies: { name: "Neonatal resuscitation" } }],
    professional_credentials: [{ title: "RN licence", issuing_body: "UNMC", credential_type: "professional_license", expiry_date: "2027-01-01" }],
    ...extra,
  };
}

async function render(mod: Promise<any>) {
  const Page = (await mod).default;
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ token: "t" }) }));
}

describe("/verify for an estate-minted link is unchanged by COMPETEN-IND-007", () => {
  beforeEach(() => { rows = {}; vi.resetModules(); });

  for (const gateOn of [false, true]) {
    for (const scope of ["full", "summary"]) {
      it(`renders byte-identically to d6252ad6 (scope ${scope}, release gate ${gateOn ? "on" : "off"})`, async () => {
        rows = estateData({
          passport_share_tokens: { ...SHARE, scope },
          practice_platform_flags: gateOn ? { enabled: true } : null,
          individual_professional_share: null,
        });
        const before = await render(import("../../../test-fixtures/verify-page-d6252ad6"));
        const after = await render(import("./page"));
        expect(after).toBe(before);
        expect(after).toContain("Verified Passport");
      });
    }
  }

  it("a Professional-minted link with the gate OFF also renders exactly as the estate page", async () => {
    rows = estateData({ practice_platform_flags: { enabled: false }, individual_professional_share: { share_token_id: SHARE.id } });
    expect(await render(import("./page"))).toBe(await render(import("../../../test-fixtures/verify-page-d6252ad6")));
  });

  it("a Professional-minted link with the gate ON shows own records by class, and drops the Verified header", async () => {
    rows = estateData({
      practice_platform_flags: { enabled: true },
      individual_professional_share: { share_token_id: SHARE.id },
      individual_professional_profile: [{ self_declared_profession: "Registered midwife", self_declared_registration_body: "UNMC", self_declared_registration_number: "M-1", self_declared_registration_country: "Uganda", self_declared_registration_expires_on: null, updated_at: null }],
      individual_professional_need: [], individual_professional_goal: [],
      individual_professional_cpd: [{ id: "x", goal_id: null, activity_type: "course", title: "NLS course", provider: null, hours: 7, cpd_points: null, activity_date: "2026-09-01", reflection: "PRIVATE REFLECTION", document_name: "c.pdf", evidence_class: "source_linked", created_at: "" }],
      individual_professional_evidence: [],
    });
    const html = await render(import("./page"));
    expect(html).not.toContain("Verified Passport");
    expect(html).toContain("Records the professional added themselves");
    expect(html).toContain("Self-declared with a document attached, not verified");
    expect(html).toContain("Self-declared, not verified");
    expect(html).not.toContain("PRIVATE REFLECTION");
    // The institution sections keep their own wording, and the framework-currency caveat path is untouched.
    expect(html).toContain("Verified credentials");
  });
});
