import { beforeEach, describe, expect, it, vi } from "vitest";

// SCHOLAR-SESSION-AI-02 slice B: the page and route side of a study session, over a mocked store.
// Ownership: a session id that is not the caller's own connected session is never linked to and never shown, and
// nothing at all happens while the policy is off or 740 is absent.

const store = vi.hoisted(() => ({
  studySessionSchema: vi.fn(), getConnectedSession: vi.fn(), getLearningSession: vi.fn(), listStudyLinks: vi.fn(),
  setLastSpace: vi.fn(), addStudyLink: vi.fn(), latestConnectedSession: vi.fn(),
}));
vi.mock("./store", () => store);
vi.mock("./learn-search", () => ({ displaySessionTitle: (t: string) => t }));
vi.mock("@/lib/individual/policy", () => ({
  loadIndividualPolicy: vi.fn(async () => ({ scholarStudySessions: true })),
  isStudySessionsOn: (p: { scholarStudySessions: boolean }, s: boolean) => p.scholarStudySessions && s,
}));

import { continueStudy, linkStudy, loadStudy } from "./study-context";

const U = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const ON = { scholarStudySessions: true };
const OFF = { scholarStudySessions: false };
const session = {
  id: S, scopeKind: "topic", title: "Sepsis", topic: "Sepsis", competencyId: null, currentStep: 0, status: "active", createdAt: "", lastActiveAt: "",
  connected: true, lastSpace: "learn", objectiveOutcome: null, objectiveText: "Recognise sepsis early",
};

beforeEach(() => {
  for (const f of Object.values(store)) f.mockReset();
  store.studySessionSchema.mockResolvedValue(true);
  store.getConnectedSession.mockResolvedValue(session);
  store.getLearningSession.mockResolvedValue({ ok: true, data: { session, steps: [{ step: 0, sections: [{ chunkId: R, materialId: R }] }] } });
  store.listStudyLinks.mockResolvedValue([{ kind: "revision_session", refId: R, createdAt: "" }]);
  store.setLastSpace.mockResolvedValue("ok");
  store.addStudyLink.mockResolvedValue("ok");
});

describe("linkStudy (ownership guard)", () => {
  it("links the caller's own connected session after the activity was made", async () => {
    await linkStudy({}, U, S, "revision_session", R, ON);
    expect(store.getConnectedSession).toHaveBeenCalledWith({}, U, S);
    expect(store.addStudyLink).toHaveBeenCalledWith({}, U, { sessionId: S, kind: "revision_session", refId: R });
  });
  it("never links a session that is not the caller's own connected one", async () => {
    store.getConnectedSession.mockResolvedValue(null);
    await linkStudy({}, U, S, "osce_attempt", R, ON);
    expect(store.addStudyLink).not.toHaveBeenCalled();
  });
  it("does nothing with no id, a non-uuid, the policy off, or 740 absent", async () => {
    await linkStudy({}, U, undefined, "evaluation", R, ON);
    await linkStudy({}, U, "new", "evaluation", R, ON);
    await linkStudy({}, U, S, "evaluation", R, OFF);
    store.studySessionSchema.mockResolvedValue(false);
    await linkStudy({}, U, S, "evaluation", R, ON);
    expect(store.addStudyLink).not.toHaveBeenCalled();
  });
  it("a failing link never throws into the activity", async () => {
    store.addStudyLink.mockRejectedValue(new Error("boom"));
    await expect(linkStudy({}, U, S, "case_session", R, ON)).resolves.toBeUndefined();
  });
});

describe("loadStudy (a page's ?study=)", () => {
  it("resolves the bar, the focus and records the space, from database reads only", async () => {
    const r = await loadStudy({}, U, S, "revise", ON);
    expect(r?.bar).toMatchObject({ id: S, title: "Sepsis", objective: "Recognise sepsis early", current: "revise" });
    expect(r?.bar.stages.map(s => s.mark)).toEqual(["started", "started", "none", "none"]);
    expect(r?.scope).toMatchObject({ kind: "topic", topic: "Sepsis", materialIds: [R] });
    expect(store.setLastSpace).toHaveBeenCalledWith({}, U, S, "revise");
  });
  it("a page that is not a stage (Library, Progress) records no space", async () => {
    await loadStudy({}, U, S, null, ON);
    expect(store.setLastSpace).not.toHaveBeenCalled();
  });
  it("another person's id, or a plain Learn session, is as if absent (no disclosure)", async () => {
    store.getConnectedSession.mockResolvedValue(null);
    expect(await loadStudy({}, U, S, "apply", ON)).toBeNull();
    expect(store.getLearningSession).not.toHaveBeenCalled();
  });
  it("off, 740 absent, or no valid id: null, and nothing read", async () => {
    expect(await loadStudy({}, U, S, "learn", OFF)).toBeNull();
    expect(await loadStudy({}, U, ["x"], "learn", ON)).toBeNull();
    store.studySessionSchema.mockResolvedValue(false);
    expect(await loadStudy({}, U, S, "learn", ON)).toBeNull();
    expect(store.getConnectedSession).not.toHaveBeenCalled();
  });
});

describe("continueStudy", () => {
  it("reopens the latest active session in its last space (Learn when none recorded); null when off", async () => {
    store.latestConnectedSession.mockResolvedValue({ ...session, lastSpace: null });
    expect(await continueStudy({}, U, ON)).toEqual({ id: S, title: "Sepsis", space: "learn" });
    expect(await continueStudy({}, U, OFF)).toBeNull();
  });
});
