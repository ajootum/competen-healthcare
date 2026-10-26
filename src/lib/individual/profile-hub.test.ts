import { describe, expect, it } from "vitest";
import { HUB_KINDS, completion, hubSections, isHubExperience, kindAllowed } from "./profile-hub";

// COMPETEN-INDIVIDUAL-PROFILE-HFE: the shared Profile & History page.

const ALL = ["overview", "qualifications", "registrations", "employment", "specialties", "aspirations"] as const;

describe("which sections each experience shows", () => {
  it("follows the configured order, and keeps the experience's own context first when configuration leaves it out", () => {
    expect(hubSections(["aspirations", "qualifications"], "professional").map(s => s.section)).toEqual(["overview", "aspirations", "qualifications"]);
    expect(hubSections(ALL, "professional").map(s => s.section)).toEqual([...ALL]);
  });
  it("a Scholar learner gets studies, education, work, interests and goals, never registrations or specialties", () => {
    const s = hubSections(ALL, "scholar");
    expect(s.map(x => x.section)).toEqual(["overview", "qualifications", "employment", "specialties", "aspirations"]);
    expect(s.flatMap(x => x.kinds.map(k => k.kind))).toEqual(["qualification", "employment", "interest", "aspiration"]);
    expect(s[0].title).toBe("Your studies");
    expect(s.find(x => x.section === "aspirations")?.title).toBe("Learning goals");
  });
  it("a section the configuration removes is not shown", () => {
    expect(hubSections(["overview", "qualifications"], "scholar").map(s => s.section)).toEqual(["overview", "qualifications"]);
  });
});

describe("what a request may add", () => {
  it("only an experience the record may come from, and only that experience's kinds", () => {
    expect(isHubExperience("scholar") && isHubExperience("professional")).toBe(true);
    expect(isHubExperience("estate")).toBe(false);
    expect(kindAllowed("scholar", "registration")).toBe(false);
    expect(kindAllowed("scholar", "aspiration")).toBe(true);
    expect(HUB_KINDS.professional.every(k => kindAllowed("professional", k))).toBe(true);
    expect(kindAllowed("professional", "verified")).toBe(false);
  });
});

describe("progressive completion", () => {
  it("counts sections started, never requires any, and leaves the context out of the count", () => {
    const s = hubSections(ALL, "scholar");
    expect(completion(s, {})).toEqual({ started: 0, total: 4 });
    expect(completion(s, { qualification: 2, aspiration: 1 })).toEqual({ started: 2, total: 4 });
  });
});
