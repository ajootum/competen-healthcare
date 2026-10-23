import { describe, expect, it } from "vitest";
import { activeProducts, assembleAccess, holdsHqPosition, listAllAuthUsers } from "./user-directory";

const none = { platform: [], enterprise: [], tenants: [], practice: [], workspaces: [], individual: [], live: [], appointments: [], hqOffices: [], positions: [] };

describe("HQ user directory (HQ-USERS-C)", () => {
  it("composes each person's access from the rows the gates read", () => {
    const { byUser, readable } = assembleAccess({
      ...none,
      platform: [{ user_id: "u", status: "active" }],
      enterprise: [{ user_id: "u", tenant_id: "t", status: "suspended" }],
      tenants: [{ id: "t", name: "St Mary" }],
      practice: [{ user_id: "u", workspace_id: "w", role_code: "practice_owner", status: "active" }],
      workspaces: [{ id: "w", name: "Riverside Clinic" }],
      individual: [{ user_id: "u", status: "active" }],
      live: [{ user_id: "u", experience_code: "professional" }, { user_id: "u", experience_code: "professional" }],
      appointments: [{ person_id: "u", role: "platform_director", status: "active", office_id: "hq" }, { person_id: "u", role: "nurse_manager", status: "active", office_id: "ward" }],
      hqOffices: [{ id: "hq" }],
      positions: [{ code: "platform_director", name: "Platform Director" }],
    });
    expect(readable).toEqual({ platform: true, enterprise: true, practice: true, individual: true, hq: true });
    const a = byUser.get("u")!;
    expect(a.enterprise).toEqual([{ tenant: "St Mary", status: "suspended" }]);
    expect(a.practice).toEqual([{ workspace: "Riverside Clinic", role: "practice_owner", status: "active" }]);
    expect(a.individual).toEqual({ membership: "active", live: ["professional"] });
    // A tenant office appointment is not an HQ position.
    expect(a.hq).toEqual([{ position: "platform_director", name: "Platform Director", status: "active" }]);
    expect(activeProducts(a)).toEqual(["platform", "practice", "individual"]);
    expect(holdsHqPosition(a)).toBe(true);
  });

  it("a source that could not be read is reported as such, never as no access", () => {
    const { readable, byUser } = assembleAccess({ ...none, practice: null, live: null, hqOffices: null });
    expect(readable).toEqual({ platform: true, enterprise: true, practice: false, individual: false, hq: false });
    expect(byUser.size).toBe(0);
  });

  it("Individual counts as a product only with a live experience, and HQ only for an active appointment", () => {
    const { byUser } = assembleAccess({ ...none, individual: [{ user_id: "u", status: "active" }],
      appointments: [{ person_id: "u", role: "chief_executive", status: "suspended", office_id: "hq" }], hqOffices: [{ id: "hq" }] });
    expect(activeProducts(byUser.get("u")!)).toEqual([]);
    expect(holdsHqPosition(byUser.get("u")!)).toBe(false);
  });

  it("reads every Auth page, and says when it could not", async () => {
    const pages = [Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}` })), [{ id: "last" }]];
    const ok = await listAllAuthUsers({ auth: { admin: { listUsers: async ({ page }: { page: number }) => ({ data: { users: pages[page - 1] ?? [] }, error: null }) } } });
    expect(ok.users).toHaveLength(1001);
    expect(ok.complete).toBe(true);
    const broken = await listAllAuthUsers({ auth: { admin: { listUsers: async ({ page }: { page: number }) => (page === 1 ? { data: { users: pages[0] }, error: null } : { data: null, error: { message: "x" } }) } } });
    expect(broken).toMatchObject({ complete: false });
    expect(broken.users).toHaveLength(1000);
  });
});
