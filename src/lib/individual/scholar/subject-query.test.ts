import { describe, expect, it } from "vitest";
import { ESTABLISHED_TERMS, SUBJECT_WORDS } from "@/lib/holdings/research/subject-terms";
import { isSubjectQuery, isSubjectWord, subjectKeywords, subjectQuery, subjectText } from "./subject-query";
import { lessonQuery } from "./learn-research";

/** Given names and surnames: Ugandan and East African, British and Irish, South Asian, Arabic, West African, and common elsewhere. */
const NAMES = `
nambi okello mukasa nakato wasswa kato babirye kizza achieng atim auma akello ocen opio odongo ojok mugisha muhwezi tumusiime byaruhanga kyomuhendo tusiime ainembabazi kabanda ssali lubega nsubuga ssemwogerere namukasa nabukenya nalwoga nantume kiggundu kaggwa mwesige wanjiru kamau otieno njeri mwangi kariuki kimani omondi juma hamisi halima neema
sarah john mary peter james david michael paul mark luke matthew andrew philip thomas simon joseph daniel samuel benjamin isaac jacob moses aaron adam noah robert richard william george henry edward charles arthur albert alfred frederick harold walter stephen kevin brian patrick sean liam connor oliver harry jack emma olivia sophia isabella charlotte amelia emily elizabeth margaret anne catherine helen alice florence rebecca rachel hannah ruth esther naomi deborah miriam lydia martha susan linda barbara jennifer jessica ashley amanda nicole michelle stephanie
smith jones taylor brown williams wilson johnson davies robinson wright thompson evans walker roberts edwards hughes green hall lewis harris clarke patel jackson wood turner martin cooper hill ward morris moore clark lee king baker harrison morgan allen james scott phillips watson davis parker price bennett young griffiths mitchell kelly cook carter richardson bailey collins bell shaw murphy miller cox richards khan marshall anderson simpson ellis adams singh begum wilkinson foster chapman powell webb rogers gray mason ali hunt holmes mills palmer matthews fisher barnes knight lloyd butler russell barker stevens jenkins dixon fletcher
grace hope faith joy mercy patience charity gloria blessing precious prudence peace comfort rose lily violet daisy ivy holly hazel jasmine dawn summer autumn april may june august
mohamed mohammed ahmed abdul fatima aisha hassan hussein ibrahim yusuf omar amina zainab priya ravi sanjay anita deepak sunita rajesh kumar sharma gupta chen wang zhang liu nguyen tran kim park sato suzuki tanaka garcia martinez rodriguez lopez gonzalez hernandez perez silva santos oliveira
chukwu okafor adeyemi oluwaseun ngozi emeka kwame kofi abena akosua ama mandela nkosi dlamini moyo banda phiri mwale
kampala mulago makerere nakasero mbarara gulu entebbe jinja nairobi mombasa lagos accra london manchester birmingham leeds
`.trim().split(/\s+/);

describe("no name leaves", () => {
  it("⚠ no name on a long list is sent, alone, in a title, or lowercase", () => {
    const passed = NAMES.filter(n => subjectQuery({ title: n }) !== "");
    expect(passed).toEqual([]);
    const pairs = NAMES.flatMap((n, i) => {
      const q = subjectQuery({ title: `Mrs ${n} ${NAMES[(i + 7) % NAMES.length]}`, objective: `Explain ${n}.`, topics: [n] });
      return q ? [q] : [];
    });
    expect(pairs).toEqual([]);
  });
  it("⚠ no name on that list is a subject word, by the list or by its ending", () => {
    expect(NAMES.filter(n => isSubjectWord(n))).toEqual([]);
  });
  it("⚠ a name beside a subject is taken out, and the subject stays", () => {
    for (const [title, want] of [
      ["Mrs Nambi pressure ulcer care at Mulago ward 5", "pressure ulcer"],
      ["sarah okello sepsis qsofa", "sepsis"],
      ["Lecture 3 BSN 2024: Wound healing", "wound healing"],
      ["Mrs Grace Stone hip fracture", "hip fracture"],
      ["Baby John Mugisha neonatal resuscitation", "neonatal resuscitation"],
    ] as const) {
      const q = subjectQuery({ title });
      expect(q).toContain(want);
      expect(q).not.toMatch(/nambi|mulago|sarah|okello|lecture|bsn|2024|grace|stone|john|mugisha|ward/i);
    }
  });
  it("⚠ digits, dates and codes never leave", () => {
    for (const t of ["Sepsis 2024", "Ward 4B sepsis", "BSN301 sepsis", "12/03/2025 sepsis", "sepsis 0772123456", "sepsis sarah@example.com"]) {
      const q = subjectQuery({ title: t });
      expect(q).toMatch(/sepsis/);
      expect(q).not.toMatch(/\d|example|sarah|ward|bsn/);
    }
  });
  it("⚠ a word after a title is a person, even when it is also a subject", () => {
    expect(subjectQuery({ title: "Dr Parkinson" })).toBe("");
    expect(subjectQuery({ title: "Mr Wilson disease" })).toBe("");
    expect(subjectQuery({ title: "Mrs Stroke" })).toBe("");
    expect(subjectText("Ms Asthma")).not.toMatch(/asthma/i);
    expect(subjectText("MS fatigue")).not.toContain(", fatigue ,");
  });
  it("⚠ nothing but the lesson's own words is read: a typed-looking sentence with no subject sends nothing", () => {
    for (const t of ["my neighbour peter", "what did she say to him", "Week 2 notes by Grace Atim", "Slide 12", "Notes", "Lesson one", "Mr Wilson and his family", "TEST ONLY reading of slide 5"]) expect(subjectQuery({ title: t })).toBe("");
  });
  it("is not fooled by accents, capitals or punctuation", () => {
    expect(subjectQuery({ title: "OKELLO" })).toBe("");
    expect(subjectQuery({ title: "Okéllo" })).toBe("");
    expect(subjectQuery({ title: "o'kello" })).toBe("");
    expect(subjectQuery({ title: "\"; DROP sarah" })).toBe("");
  });
});

describe("what is meaningful stays", () => {
  it("⚠ diseases and syndromes named after people are kept, not stripped because they look like names", () => {
    for (const [title, want] of [
      ["Parkinson's disease", "parkinson"], ["Alzheimer's disease", "alzheimer"], ["Crohn's disease", "crohn"], ["Down's syndrome", "down syndrome"], ["Turner syndrome", "turner syndrome"], ["Wilson's disease", "wilson disease"],
      ["Graves' disease", "graves disease"], ["Cushing's syndrome", "cushing syndrome"], ["Guillain-Barré syndrome", "guillain barre"], ["Kawasaki disease", "kawasaki"], ["Hodgkin lymphoma", "hodgkin lymphoma"], ["Bell's palsy", "bell palsy"],
      ["Burkitt lymphoma", "burkitt"], ["Lassa fever", "lassa"], ["Ebola virus disease", "ebola"], ["Glasgow Coma Scale", "glasgow coma scale"], ["Apgar score", "apgar"], ["Donabedian model", "donabedian"],
    ] as const) expect(subjectQuery({ title })).toContain(want);
  });
  it("⚠ theories named after people are kept", () => {
    for (const [title, want] of [["Erikson's stages", "erikson"], ["Piaget's cognitive development", "piaget"], ["Bowlby's attachment theory", "bowlby"], ["Maslow's hierarchy of needs", "maslow"], ["Vygotsky's zone", "vygotsky"], ["Kohlberg's moral development", "kohlberg"]] as const)
      expect(subjectQuery({ title })).toContain(want);
  });
  it("⚠ an established term passes only whole: its name alone does not", () => {
    for (const [name] of [["wilson"], ["turner"], ["graves"], ["bell"], ["down"], ["cushing"], ["glasgow"], ["hodgkin"]] as const) expect(subjectQuery({ title: name })).toBe("");
    expect(ESTABLISHED_TERMS.length).toBeGreaterThan(50);
  });
  it("a disease the list does not hold still passes by its medical form", () => {
    expect(subjectQuery({ title: "Podoconiosis" })).toContain("podoconiosis");
    expect(subjectQuery({ title: "Tungiasis" })).toContain("tungiasis");
    expect(subjectQuery({ title: "Cholangiopathy" })).toContain("cholangiopathy");
  });
  it("Growth and Development keeps its subject", () => {
    expect(subjectQuery({ title: "Critical sensitive periods", objective: "Explain critical sensitive periods, including principles of growth and development.", concepts: ["Critical Sensitive Periods", "Principles of growth and development"] })).toContain("critical sensitive periods");
    expect(subjectQuery({ title: "Types of growth and development", concepts: ["Anterior fontanel", "Height"] })).toContain("anterior fontanel");
  });
  it("either spelling, and a plural", () => {
    for (const w of ["haemorrhage", "hemorrhage", "anaemia", "anemia", "oedema", "edema", "paediatric", "pediatric", "ulcers", "ulcer", "fractures", "immunisation", "immunization", "tumour", "tumor"]) expect(isSubjectWord(w)).toBe(true);
  });
  it("generic words alone are not a search", () => {
    for (const t of ["care", "quality", "patient care", "management", "treatment", "clinical practice"]) expect(subjectQuery({ title: t })).toBe("");
  });
});

describe("the last check", () => {
  it("⚠ refuses any part of a built query that is not subject terms (the planted failures)", () => {
    expect(isSubjectQuery('"sepsis management" okello')).toBe(false);
    expect(isSubjectQuery('"okello sepsis"')).toBe(false);
    expect(isSubjectQuery("wilson")).toBe(false);
    expect(isSubjectQuery("sepsis 2024")).toBe(false);
    expect(isSubjectQuery("")).toBe(false);
    expect(isSubjectQuery("the")).toBe(false);
    expect(isSubjectQuery('"wilson disease" sepsis')).toBe(true);
  });
  it("⚠ the vocabulary holds no digit, no capital and no name on the list", () => {
    expect(SUBJECT_WORDS.filter(w => !/^[a-z][a-z0-9-]*$/.test(w))).toEqual([]);
    const words = new Set(SUBJECT_WORDS);
    expect(NAMES.filter(n => words.has(n))).toEqual([]);
  });
  it("⚠ keywords pass the same reading", () => {
    expect(subjectKeywords("my neighbour peter has hiv, explain cd4")).toBe("hiv");
    expect(subjectKeywords("what did sarah say")).toBe("");
  });
});

describe("lessonQuery", () => {
  it("⚠ sends nothing when nothing safe is left, and says why", () => {
    expect(lessonQuery({ topics: [], title: "Week 2 notes by Grace Atim" })).toEqual({ ok: false, reason: "no_safe_terms" });
    expect(lessonQuery({ topics: ["peter"], title: null })).toEqual({ ok: false, reason: "no_safe_terms" });
    expect(lessonQuery({ topics: [], title: "   " })).toEqual({ ok: false, reason: "empty" });
  });
  it("⚠ a patient identifier anywhere still refuses the whole search", () => {
    expect(lessonQuery({ topics: ["sepsis"], title: "Hospital number 00482913" })).toEqual({ ok: false, reason: "identifier" });
  });
  it("⚠ the name Ask's guard caught stays out", () => {
    const q = lessonQuery({ topics: ["mrs nambi age 72 at mulago ward", "sepsis", "qsofa"], title: null });
    expect(q.ok && q.query).toMatch(/sepsis/);
    expect(JSON.stringify(q)).not.toMatch(/nambi|mulago|ward|72|mrs|age/);
  });
});
