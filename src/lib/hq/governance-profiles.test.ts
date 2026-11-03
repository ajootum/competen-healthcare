import { describe, expect, it } from "vitest";
import { CLINICAL_APPROVAL, PROFILES, STANDARD_CONTENT_GOVERNANCE, profileGaps } from "./governance-profiles";
import { HQ_CAPABILITY_CODES } from "./spaces";

describe("governance profiles", () => {
  it("keeps clinical approval out of the standard profile", () => {
    expect(STANDARD_CONTENT_GOVERNANCE).toHaveLength(14);   // 942: the four policy rights joined the profile
    expect(PROFILES.executive.capabilities).not.toContain(CLINICAL_APPROVAL[0]);
    expect(PROFILES.management.capabilities).not.toContain(CLINICAL_APPROVAL[0]);
  });
  it("names only codes the code catalogue defines", () => {
    for (const c of [...STANDARD_CONTENT_GOVERNANCE, ...CLINICAL_APPROVAL]) expect(HQ_CAPABILITY_CODES, c).toContain(c);
  });
  it("profileGaps returns what is still to grant, in profile order", () => {
    expect(profileGaps(PROFILES.executive, [])).toEqual([...STANDARD_CONTENT_GOVERNANCE]);
    expect(profileGaps(PROFILES.executive, ["hq.platform.home.view", "hq.quality.competency.publish", "hq.unrelated"]))
      .toEqual(STANDARD_CONTENT_GOVERNANCE.filter(c => c !== "hq.platform.home.view" && c !== "hq.quality.competency.publish"));
    expect(profileGaps(PROFILES.management, [...STANDARD_CONTENT_GOVERNANCE])).toEqual([]);
  });
});
