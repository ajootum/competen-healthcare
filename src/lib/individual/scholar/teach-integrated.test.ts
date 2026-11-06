import { describe, expect, it } from "vitest";
import { beyondNotes, checkIntegrated, claimCheckUser, claimsOf, integratedSystem, isIntegratedVersion, notesOnlyProjection, parseUnsupported, runIntegratedTeach, sentencesOf, tagsOf, type PackEvidence } from "./teach-integrated";
import type { Passage } from "./generation";
import { citationSegments, parseTeachAnswer } from "./teach-format";

const passage = (i: number, content: string): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Growth notes", ordinal: i, pageFrom: i, pageTo: i, unit: "slide", content });
const passages = [
  passage(1, "A critical period begins and ends quickly. A sensitive period begins and ends gradually."),
  passage(2, "Consistent care from one person allows the infant to develop trust and feel secure."),
];
const evidence: PackEvidence[] = [{ title: "Sensitive periods in brain development", journal: "Dev Rev", year: 2021, kind: "systematic review", abstract: "Sensitive periods reflect plasticity that declines gradually. Across 14 studies, early enrichment partly offset deprivation, with wide variation between children." }];
const ctx = { passages, references: [], evidence, asked: "Teach me this step." };

const lesson = (understanding: string, extra = "") => [
  "OVERVIEW: This lesson separates critical periods from sensitive periods [S1]. It matters because early care shapes trust [S2].",
  `UNDERSTANDING: ${understanding}`,
  extra,
  "KEY POINTS:\n- A sensitive period begins and ends gradually [S1].",
  "CHECK YOUR UNDERSTANDING:\n- Why does consistent care matter? [S2]",
].filter(Boolean).join("\n\n");

describe("sentences", () => {
  it("a tag after the full stop belongs to the sentence before it", () => {
    expect(sentencesOf("It grows. [S1] It stops [S2].")).toEqual(["It grows [S1].", "It stops [S2]."]);
  });
  it("short forms do not end a sentence", () => {
    expect(sentencesOf("Reviews, e.g. by Smith et al. in this field, agree [E1]. Next [S1].")).toHaveLength(2);
  });
  it("reads the three sources", () => {
    expect(tagsOf("A [S1][E2] [AI].")).toEqual({ s: [1], e: [2], r: [], ai: true });
  });
});

describe("each sentence is read against the source it names", () => {
  it("keeps a lesson that does what it says, in all three sources", () => {
    const c = checkIntegrated(lesson("Sensitive periods reflect plasticity that declines gradually [E1]. Think of a window that closes slowly rather than a door that shuts [AI]."), ctx);
    expect(c.check.ok).toBe(true);
    expect(c.dropped).toEqual([]);
    expect(c.shown.evidence).toBe(1);
    expect(c.shown.ai).toBe(1);
    expect(c.citedEvidence).toEqual([1]);
  });

  it("a number the cited abstract does not hold is left out, and the lesson stands", () => {
    const c = checkIntegrated(lesson("Across 92 studies plasticity declined [E1]. A window closes slowly [AI]."), ctx);
    expect(c.check.ok).toBe(true);
    expect(c.dropped.map(d => d.reason)).toContain("evidence_ungrounded");
    expect(c.check.ok && c.check.text).not.toContain("92");
  });

  it("a number the abstract does hold stands", () => {
    const c = checkIntegrated(lesson("Across 14 studies early enrichment partly offset deprivation [E1]."), ctx);
    expect(c.dropped).toEqual([]);
  });

  it("a citation it was never given is left out: nothing invents a reference", () => {
    const c = checkIntegrated(lesson("A trial found this [E7]. Plasticity declines gradually [E1]."), ctx);
    expect(c.dropped.map(d => d.reason)).toContain("unknown_tag");
    expect(c.check.ok && c.check.text).not.toContain("E7");
  });

  it("Scholar's own sentence may not claim evidence, and may not carry a figure", () => {
    const c = checkIntegrated(lesson("Research shows this is permanent [AI]. It takes three years to close [AI]. A window closes slowly [AI]."), ctx);
    expect(c.dropped.map(d => d.reason).sort()).toEqual(["ai_claims_evidence", "ai_rules"]);
    expect(c.check.ok && c.check.text).toContain("A window closes slowly");
  });

  it("a sentence with no tag at all is Scholar's own, and says so", () => {
    const c = checkIntegrated(lesson("A window closes slowly."), ctx);
    expect(c.check.ok && c.check.text).toContain("A window closes slowly [AI].");
  });

  it("a claim to have read the full paper is left out: only abstracts were read", () => {
    const c = checkIntegrated(lesson("The full text of this review shows plasticity declines [E1]."), ctx);
    expect(c.dropped.map(d => d.reason)).toContain("claims_full_text");
  });

  it("dosing in a research sentence is left out", () => {
    const c = checkIntegrated(lesson("The dose was increased gradually [E1]. A window closes slowly [AI]."), ctx);
    expect(c.dropped.map(d => d.reason)).toContain("evidence_dosing");
  });

  it("a sentence that claims the notes and adds a figure in a safety context withholds the whole lesson", () => {
    const c = checkIntegrated(lesson("Give the infant 5 mg of the drug every 4 hours [S2]."), ctx);
    expect(c.check.ok).toBe(false);
  });

  it("an identifier anywhere withholds everything", () => {
    const c = checkIntegrated(lesson("A window closes slowly [AI]. Hospital number MRN 1234567 shows this [S1]."), ctx);
    expect(c.check.ok).toBe(false);
    expect(c.lesson).toBeNull();
  });

  it("a lesson that has lost the notes is withheld: they stay the foundation", () => {
    const raw = `OVERVIEW: Plasticity declines gradually [E1]. Early enrichment partly offset deprivation [E1]. A window closes slowly [AI]. A door shuts quickly [AI]. A window is open for a time [AI]. Windows differ [AI].\n\nUNDERSTANDING: One line from the notes begins and ends quickly [S1].`;
    expect(checkIntegrated(raw, ctx).check.ok).toBe(false);
  });

  it("an answer without the labelled parts is not this lesson", () => {
    expect(checkIntegrated("Just some prose [S1].", ctx).check.ok).toBe(false);
  });
});

describe("where evidence refines the notes", () => {
  const line = "NOTES AND EVIDENCE:\n- Your notes say a critical period begins and ends quickly [S1]. Published evidence describes plasticity that declines gradually [E1].";

  it("shows both sides, each with its own citation", () => {
    const c = checkIntegrated(lesson("A window closes slowly [AI].", line), ctx);
    const parts = parseTeachAnswer(c.check.ok ? c.check.text : "")!;
    expect(parts.distinctions).toHaveLength(1);
    expect(parts.distinctions![0]).toContain("[S1]");
    expect(parts.distinctions![0]).toContain("[E1]");
  });

  it("is dropped if it does not show both, because then it could read as being in the notes", () => {
    const c = checkIntegrated(lesson("A window closes slowly [AI].", "NOTES AND EVIDENCE:\n- Published evidence describes plasticity that declines gradually [E1]."), ctx);
    expect(parseTeachAnswer(c.check.ok ? c.check.text : "")!.distinctions).toBeUndefined();
  });
});

describe("the claim check", () => {
  const good = lesson("Sensitive periods reflect plasticity that declines gradually [E1]. A window closes slowly [AI].");
  const runner = (verify: { ok: true; text: string } | { ok: false; error: "failed" }) => {
    const calls: string[] = [];
    const run = async (g: { user: string; tier?: string }, part?: string) => {
      calls.push(`${part ?? "main"}:${g.tier}`);
      if (part === "verify") return verify.ok ? { ok: true as const, text: verify.text, provider: "p", model: "m", usage: { input: 1, output: 1 } } : { ok: false as const, error: "failed" as const };
      return { ok: true as const, text: good, provider: "p", model: "main-model", usage: { input: 1, output: 1 } };
    };
    return { calls, run: run as never };
  };
  const go = (run: never) => runIntegratedTeach("u", { question: "Teach me this step.", passages, references: [], depth: "standard", learnerContext: null, lesson: null, evidence }, run);

  it("makes exactly two model calls, the check on the cheap tier", async () => {
    const r = runner({ ok: true, text: "[]" });
    const out = await go(r.run);
    expect(r.calls).toEqual(["main:reasoning", "verify:cheap"]);
    expect(out.ok && out.integrated.verified).toBe(true);
    expect(out.ok && out.promptVersion && isIntegratedVersion(out.promptVersion)).toBe(true);
  });

  it("a sentence its citation does not support is left out", async () => {
    const list = claimsOf(checkIntegrated(good, ctx).lesson!);
    const n = list.findIndex(c => c.sentence.includes("[E1]")) + 1;
    const out = await go(runner({ ok: true, text: `[${n}]` }).run);
    expect(out.ok && out.check.ok && out.check.text).not.toContain("[E1]");
    expect(out.ok && out.integrated.unsupported).toBe(1);
    expect(out.ok && out.integrated.citedEvidence).toEqual([]);
  });

  it("if the check fails, nothing cited to research stands: a citation nobody checked is not shown", async () => {
    const out = await go(runner({ ok: false, error: "failed" }).run);
    expect(out.ok && out.check.ok).toBe(true);
    expect(out.ok && out.check.ok && out.check.text).not.toContain("[E1]");
    expect(out.ok && out.integrated.verified).toBe(false);
  });

  it("if the check's reply cannot be read, the same", async () => {
    const out = await go(runner({ ok: true, text: "they all look fine" }).run);
    expect(out.ok && out.check.ok && out.check.text).not.toContain("[E1]");
  });

  it("each claim names only what it cites, and each source is sent once", () => {
    const list = claimsOf(checkIntegrated(good, ctx).lesson!);
    const e = list.find(c => c.sentence.includes("[E1]"))!;
    expect(e.cites).toEqual(["E1"]);
    expect(list.some(c => c.sentence.includes("[AI]"))).toBe(false);
    const user = claimCheckUser(list, ctx);
    expect(user.split(evidence[0].abstract)).toHaveLength(2);
    expect(user).toContain("(cites E1)");
  });

  it("what the notes do not say is not presented as the notes: it becomes Scholar's own, labelled", async () => {
    const withDefinition = lesson("Cephalocaudal means development proceeds from the head downward [S1]. Plasticity declines gradually [E1].");
    const list = claimsOf(checkIntegrated(withDefinition, ctx).lesson!);
    const n = list.findIndex(c => c.sentence.includes("Cephalocaudal")) + 1;
    const run = (async (_g: unknown, part?: string) => ({ ok: true as const, text: part === "verify" ? `[${n}]` : withDefinition, provider: "p", model: "m", usage: { input: 1, output: 1 } })) as never;
    const out = await runIntegratedTeach("u", { question: "Teach me this step.", passages, references: [], depth: "standard", learnerContext: null, lesson: null, evidence }, run);
    expect(out.ok && out.check.ok && out.check.text).toContain("from the head downward [AI].");
    expect(out.ok && out.check.ok && out.check.text).not.toContain("downward [S1]");
    expect(out.ok && out.integrated.relabelled).toBe(1);
  });

  it("what an abstract does not say is not re-labelled: it goes", async () => {
    const withClaim = lesson("Plasticity declines gradually [E1].");
    const list = claimsOf(checkIntegrated(withClaim, ctx).lesson!);
    const n = list.findIndex(c => c.sentence.includes("[E1]")) + 1;
    const run = (async (_g: unknown, part?: string) => ({ ok: true as const, text: part === "verify" ? `[${n}]` : withClaim, provider: "p", model: "m", usage: { input: 1, output: 1 } })) as never;
    const out = await runIntegratedTeach("u", { question: "Teach me this step.", passages, references: [], depth: "standard", learnerContext: null, lesson: null, evidence }, run);
    expect(out.ok && out.check.ok && out.check.text).not.toContain("Plasticity declines");
    expect(out.ok && out.integrated.relabelled).toBe(0);
  });

  it("reads a list, and ignores numbers outside it", () => {
    expect([...parseUnsupported("[2, 9, 0]", 3)!]).toEqual([2]);
    expect(parseUnsupported("nope", 3)).toBeNull();
  });
});

describe("what happens to a shown lesson", () => {
  const text = checkIntegrated(lesson("Sensitive periods reflect plasticity that declines gradually [E1]. A window closes slowly [AI]."), ctx);
  const shown = text.check.ok ? text.check.text : "";

  it("falls back to its notes sentences, with nothing of research left", () => {
    const only = notesOnlyProjection(shown)!;
    expect(only).not.toMatch(/\[E\d+\]|\[AI\]/);
    expect(only).toContain("[S1]");
    expect(only).toContain("CHECK YOUR UNDERSTANDING");
  });

  it("gives the risk rules exactly what goes beyond the notes", () => {
    const b = beyondNotes(shown);
    expect(b).toContain("declines gradually");
    expect(b).toContain("window closes slowly");
    expect(b).not.toContain("critical periods from sensitive");
  });

  it("the three tags are told apart on the page", () => {
    expect(citationSegments("A [S1] B [E2] C [AI].").filter(x => !("text" in x))).toEqual([{ tag: 1 }, { evidence: 2 }, { ai: true }]);
  });
});

describe("the prompt", () => {
  it("names the three sources and says abstracts only", () => {
    const s = integratedSystem("standard");
    expect(s).toContain("[S n]");
    expect(s).toContain("[E n]");
    expect(s).toContain("[AI]");
    expect(s).toMatch(/abstracts only/i);
    expect(s).toMatch(/Citation counts/);
  });
});
