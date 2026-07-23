"use client";
import { useState } from "react";

// Shared audit instruments: the 62-item ABCDE assessment data, Benner grade
// helpers, report generators and the Match (yes/no/partial) audit used by the
// concurrent and retrospective chart audits.

// ── SHEET 1: Assessment Audit — graded 0–6 ──────────────────────────────────
export const ASSESSMENT_SECTIONS = [
  {
    title: "Safety & Preparation",
    items: [
      { num: 1,  text: "Ensures Hand hygiene precautions" },
      { num: 2,  text: "Utilises at least 2 identifiers" },
      { num: 3,  text: "Ensures privacy" },
      { num: 4,  text: "Equipment readiness (stethoscope, BP cuff, SpO₂, etc.)" },
    ],
  },
  {
    title: "Step 1: Initial Impression (PAT)",
    items: [
      { num: 5,  text: "Appearance (LOC/GCS/AVPU, tone, cry)" },
      { num: 6,  text: "Work of Breathing (position, retractions)" },
      { num: 7,  text: "Circulation to Skin (colour)" },
      { num: 8,  text: "Unresponsive/abnormal breathing/colour — activates Code Blue" },
      { num: 9,  text: "Responsive but urgent (Code Green)" },
      { num: 10, text: "Responsive and not urgent — continues assessment" },
    ],
  },
  {
    title: "Step 2: Primary – Airway",
    items: [
      { num: 11, text: "Assesses patency (crying/talking, chest movement, sounds)" },
      { num: 12, text: "Classifies airway correctly: Patent / Maintainable / Not Maintainable" },
      { num: 13, text: "Intervenes appropriately as per policy" },
    ],
  },
  {
    title: "Step 2: Primary – Breathing",
    items: [
      { num: 14, text: "RR & pattern (uses age table)" },
      { num: 15, text: "Respiratory effort (nasal flaring, retractions)" },
      { num: 16, text: "Chest expansion and symmetry" },
      { num: 17, text: "Auscultates chest (stridor, wheezing, crackles, grunting)" },
      { num: 18, text: "SpO₂ (>94%)" },
    ],
  },
  {
    title: "Step 2: Primary – Circulation",
    items: [
      { num: 19, text: "Heart rate and rhythm (utilises age table as appropriate)" },
      { num: 20, text: "Central and peripheral pulses" },
      { num: 21, text: "Capillary Refill Time (>2s) — peripheral and/or central" },
      { num: 22, text: "Skin colour/temp, BP" },
      { num: 23, text: "Blood pressure (uses age table as appropriate)" },
      { num: 24, text: "Heart sounds — normal and added" },
      { num: 25, text: "JVP/heaves/murmurs" },
    ],
  },
  {
    title: "Step 2: Primary – Disability",
    items: [
      { num: 26, text: "Level of consciousness (GCS), pupillary reaction" },
      { num: 27, text: "Pain and/or sedation (FLACC, Wong-Baker FACES/RASS)" },
      { num: 28, text: "Cranial nerve function, head circumference" },
      { num: 29, text: "Motor function: muscle bulk, power (0–5 scale), tone, reflexes (deep tendon & primitive)" },
      { num: 30, text: "Sensory function" },
      { num: 31, text: "Risk for raised intracranial pressure" },
    ],
  },
  {
    title: "Step 2: Primary – Exposure",
    items: [
      { num: 32, text: "Temperature" },
      { num: 33, text: "Skin colour/hydration status/oedema (pitting grades 1–4)" },
      { num: 34, text: "Skin turgor" },
      { num: 35, text: "Pressure ulcer and risk" },
      { num: 36, text: "Dysmorphic features (head-to-toe)" },
      { num: 37, text: "Neurocutaneous lesions" },
      { num: 38, text: "Shunt tract, CSF leak, wound breakdown" },
      { num: 39, text: "Drains — EVD" },
    ],
  },
  {
    title: "GI/Feeding & Renal Systems",
    items: [
      { num: 40, text: "History — feeding (type, frequency, tolerance); bowel habits" },
      { num: 41, text: "Inspection, auscultation, palpation and percussion of the abdomen" },
      { num: 42, text: "Anthropometry — weight, height, MUAC" },
      { num: 43, text: "History — habits and changes, symptoms (frequency, urgency, dysuria, urine colour, facial puffiness)" },
      { num: 44, text: "Costovertebral angle tenderness" },
      { num: 45, text: "Bruits" },
    ],
  },
  {
    title: "Step 3: Secondary Assessment (SAMPLE)",
    items: [
      { num: 46, text: "Signs and Symptoms" },
      { num: 47, text: "Allergies" },
      { num: 48, text: "Medications" },
      { num: 49, text: "Past Medical and Surgical History" },
      { num: 50, text: "Last Meal" },
      { num: 51, text: "Events" },
      { num: 52, text: "Laboratory findings — intervenes as appropriate" },
      { num: 53, text: "Reviews radiological findings — intervenes as appropriate" },
    ],
  },
  {
    title: "Step 4: Problem Identification & Intervention",
    items: [
      { num: 54, text: "Analyses trends from previous shift(s) and/or admissions" },
      { num: 55, text: "Identifies the deteriorating patient early; determines PEWS Score appropriately" },
      { num: 56, text: "Determines appropriate NANDA diagnoses" },
      { num: 57, text: "Identifies patient condition by type and severity (PALS approach)" },
      { num: 58, text: "Intervenes appropriately based on assessment findings" },
    ],
  },
  {
    title: "Step 5: Reassessment & Escalation",
    items: [
      { num: 59, text: "Develops an appropriate reassessment and monitoring plan (intervals per policy)" },
      { num: 60, text: "Escalates care for patients appropriately" },
    ],
  },
  {
    title: "Documentation & Handover",
    items: [
      { num: 61, text: "Documents appropriately as per policy" },
      { num: 62, text: "Appropriately hands over patients" },
    ],
  },
];

export const GRADE_LABELS: Record<number, { level: string; color: string }> = {
  0: { level: "Novice",            color: "bg-red-100 text-red-700" },
  1: { level: "Advanced Beginner", color: "bg-orange-100 text-orange-700" },
  2: { level: "Advanced Beginner", color: "bg-amber-100 text-amber-700" },
  3: { level: "Competent",         color: "bg-blue-100 text-blue-700" },
  4: { level: "Competent",         color: "bg-blue-100 text-blue-700" },
  5: { level: "Proficient",        color: "bg-teal-100 text-teal-700" },
  6: { level: "Expert",            color: "bg-green-100 text-green-700" },
};

// ── SHEET 2: Concurrent Audit — Yes/No/Partial ───────────────────────────────
export const CONCURRENT_SECTIONS = [
  {
    title: "Initial Impression (PAT)",
    items: [
      { num: 1,  text: "Appearance, Work of Breathing, Circulation documented" },
      { num: 2,  text: "Appropriate decision/intervention (BLS vs Primary)" },
    ],
  },
  {
    title: "Airway Categorised Appropriately",
    items: [
      { num: 3,  text: "Clear" },
      { num: 4,  text: "Maintainable" },
      { num: 5,  text: "Non-maintainable" },
    ],
  },
  {
    title: "Breathing",
    items: [
      { num: 6,  text: "Respiratory rate" },
      { num: 7,  text: "Respiratory effort" },
      { num: 8,  text: "Respiratory pattern" },
      { num: 9,  text: "Airway sounds documented" },
      { num: 10, text: "Lung sounds documented" },
      { num: 11, text: "SpO₂" },
    ],
  },
  {
    title: "Circulation",
    items: [
      { num: 12, text: "Heart rate & Rhythm" },
      { num: 13, text: "Peripheral and central pulses" },
      { num: 14, text: "Capillary refill time" },
      { num: 15, text: "Blood pressure" },
      { num: 16, text: "Skin temperature and gradient" },
    ],
  },
  {
    title: "Disability",
    items: [
      { num: 17, text: "Level of consciousness (GCS), pupillary reaction" },
      { num: 18, text: "Pain and/or sedation (FLACC, Wong-Baker FACES/RASS)" },
      { num: 19, text: "Cranial nerve function, head circumference" },
      { num: 20, text: "Motor function (muscle bulk, power, tone, reflexes)" },
      { num: 21, text: "Sensory function" },
      { num: 22, text: "Risk for raised intracranial pressure" },
    ],
  },
  {
    title: "Exposure",
    items: [
      { num: 23, text: "Temperature" },
      { num: 24, text: "Skin colour/hydration status/oedema (pitting grades 1–4)" },
      { num: 25, text: "Skin turgor" },
      { num: 26, text: "Pressure ulcer and risk" },
      { num: 27, text: "Dysmorphic features (head-to-toe)" },
      { num: 28, text: "Neurocutaneous lesions" },
      { num: 29, text: "Shunt tract, CSF leak, wound breakdown" },
      { num: 30, text: "Drains — EVD" },
    ],
  },
  {
    title: "GI/Feeding",
    items: [
      { num: 31, text: "History — feeding (type, frequency, tolerance); bowel habits" },
      { num: 32, text: "Inspection, auscultation, palpation and percussion of the abdomen" },
      { num: 33, text: "Anthropometry — weight, height, MUAC" },
    ],
  },
  {
    title: "Renal",
    items: [
      { num: 34, text: "History — habits and changes, symptoms (frequency, urgency, dysuria, urine colour, facial puffiness)" },
      { num: 35, text: "Costovertebral angle tenderness" },
      { num: 36, text: "Bruits" },
    ],
  },
  {
    title: "Secondary / SAMPLE",
    items: [
      { num: 37, text: "Signs and Symptoms" },
      { num: 38, text: "Allergies" },
      { num: 39, text: "Medications" },
      { num: 40, text: "Past Medical and Surgical History" },
      { num: 41, text: "Last Meal" },
      { num: 42, text: "Events" },
      { num: 43, text: "Laboratory findings — intervenes as appropriate" },
      { num: 44, text: "Reviews radiological findings — intervenes as appropriate" },
    ],
  },
  {
    title: "Problem Identification & EII",
    items: [
      { num: 45, text: "Analyses trends from previous shift(s) and/or admissions" },
      { num: 46, text: "Identifies the deteriorating patient early; determines PEWS Score appropriately" },
      { num: 47, text: "Determines appropriate NANDA diagnoses" },
      { num: 48, text: "Identifies patient condition by type and severity (PALS approach)" },
      { num: 49, text: "Intervenes appropriately based on assessment findings" },
    ],
  },
  {
    title: "Reassessment / Escalation",
    items: [
      { num: 50, text: "Develops an appropriate reassessment and monitoring plan (intervals per policy)" },
      { num: 51, text: "Escalates care for patients appropriately" },
    ],
  },
];

// ── SHEET 3: Retrospective Chart Audit — Yes/No/Partial ──────────────────────
export const CHART_SECTIONS = [
  {
    title: "Timing of Assessments",
    items: [
      { num: 1,  text: "Initial comprehensive assessment within 24h of admission" },
      { num: 2,  text: "Focused assessment at beginning and end of shift" },
      { num: 3,  text: "Handover documented appropriately" },
      { num: 4,  text: "Change in condition, pre/post-intervention documented" },
    ],
  },
  {
    title: "Initial Impression (PAT)",
    items: [
      { num: 5,  text: "Appearance, Work of Breathing, Circulation documented with appropriate decision/intervention (BLS vs Primary)" },
    ],
  },
  {
    title: "Primary ABCDE – Airway",
    items: [
      { num: 6,  text: "Airway patency classification + intervention documented, as appropriate" },
    ],
  },
  {
    title: "Primary – Breathing",
    items: [
      { num: 7,  text: "Respiratory rate and pattern (age-appropriate) documented" },
      { num: 8,  text: "Respiratory effort; chest expansion and auscultation and SpO₂ findings documented" },
      { num: 9,  text: "Respiratory function analysis documented, appropriately" },
      { num: 10, text: "Respiratory interventions documented, appropriate" },
    ],
  },
  {
    title: "Primary – Circulation",
    items: [
      { num: 11, text: "Heart rate and rhythm (ECG) documented appropriately" },
      { num: 12, text: "Strength of pulses (peripheral and central) documented, appropriate" },
      { num: 13, text: "CRT, skin colour and temperature (temperature gradient) documented" },
      { num: 14, text: "BP (and additional CV findings) documented appropriately" },
      { num: 15, text: "Cardiovascular function analysis documented, appropriately" },
      { num: 16, text: "Cardiovascular function interventions documented, appropriate" },
    ],
  },
  {
    title: "Primary – Disability",
    items: [
      { num: 17, text: "Level of consciousness (GCS/AVPU) documented appropriately" },
      { num: 18, text: "Pain and sedation scores documented using appropriate scales" },
      { num: 19, text: "Cranial nerve function documented, appropriate" },
      { num: 20, text: "Motor function documented (bulk, power, tone and reflexes)" },
      { num: 21, text: "Sensory function documented appropriately" },
      { num: 22, text: "Raised ICP risk assessment" },
    ],
  },
  {
    title: "Primary – Exposure",
    items: [
      { num: 23, text: "Temp, skin (colour, moisture, oedema grades 1–4, turgor, lesions, pressure risk)" },
      { num: 24, text: "Temperature documented" },
      { num: 25, text: "Skin colour, hydration status, oedema, turgor documented" },
      { num: 26, text: "Skin lesions, pressure ulcer and risk assessed" },
      { num: 27, text: "Shunt tract, CSF leak, wound breakdown/function" },
      { num: 28, text: "Drains (e.g. EVD function)" },
    ],
  },
  {
    title: "GI/Feeding & Renal",
    items: [
      { num: 29, text: "GI history data documented" },
      { num: 30, text: "GI assessment documented" },
      { num: 31, text: "Nutrition plan documented (e.g. monitoring, feeding)" },
      { num: 32, text: "Renal history data documented" },
      { num: 33, text: "Renal assessment documented" },
      { num: 34, text: "Management plan documented, appropriate" },
    ],
  },
  {
    title: "Secondary Assessment",
    items: [
      { num: 35, text: "SAMPLE history documented, as appropriate" },
      { num: 36, text: "Laboratory results reviewed, plan documented" },
      { num: 37, text: "Radiology results reviewed, plan documented" },
    ],
  },
  {
    title: "Problem Identification",
    items: [
      { num: 38, text: "Patient assessment data trends analysed, documented" },
      { num: 39, text: "NANDA diagnoses documented, appropriate" },
      { num: 40, text: "PALS severity and type documented, appropriate" },
      { num: 41, text: "Interventions documented, appropriate" },
    ],
  },
  {
    title: "Reassessment & Escalation",
    items: [
      { num: 42, text: "Ongoing reassessments done as per acuity/PEWS" },
      { num: 43, text: "Timely escalation documented" },
      { num: 44, text: "Patient response to treatments/interventions documented" },
    ],
  },
  {
    title: "Overall Documentation",
    items: [
      { num: 45, text: "Legible documentation" },
      { num: 46, text: "Dated and signed appropriately" },
      { num: 47, text: "No blanks" },
      { num: 48, text: "Links to care plan" },
    ],
  },
];

type MatchValue = "yes" | "no" | "partial";
export type InfoField = { key: string; label: string; placeholder: string };

// ── Helpers ───────────────────────────────────────────────────────────────────
export function avgToLevel(avg: number): string {
  if (avg >= 5.5) return "Expert";
  if (avg >= 4.5) return "Proficient";
  if (avg >= 2.5) return "Competent";
  if (avg >= 1.5) return "Advanced Beginner";
  return "Novice";
}
export const LEVEL_COLORS: Record<string, string> = {
  "Expert":            "bg-green-100 text-green-700 border-green-200",
  "Proficient":        "bg-teal-100 text-teal-700 border-teal-200",
  "Competent":         "bg-blue-100 text-blue-700 border-blue-200",
  "Advanced Beginner": "bg-amber-100 text-amber-700 border-amber-200",
  "Novice":            "bg-red-100 text-red-700 border-red-200",
};

// ── Controlled info fields ────────────────────────────────────────────────────
function InfoFields({
  fields, values, onChange,
}: {
  fields: InfoField[];
  values: Record<string, string>;
  onChange: (key: string, v: string) => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
      {fields.map(f => (
        <div key={f.key}>
          <label className="text-[10px] font-bold text-gray-400 tracking-widest uppercase block mb-1">{f.label}</label>
          <input
            type="text"
            placeholder={f.placeholder}
            value={values[f.key] ?? ""}
            onChange={e => onChange(f.key, e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100"
          />
        </div>
      ))}
    </div>
  );
}

// ── Comments ──────────────────────────────────────────────────────────────────
export function CommentsSection({
  assessorVal, assesseeLabel, assesseeVal, onAssessor, onAssessee,
}: {
  assessorVal: string; assesseeLabel: string; assesseeVal: string;
  onAssessor: (v: string) => void; onAssessee: (v: string) => void;
}) {
  return (
    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <label className="text-[10px] font-bold text-gray-400 tracking-widest uppercase block mb-2">
          Assessor / Auditor Comments
        </label>
        <textarea
          rows={5}
          placeholder="Observations, areas for development, overall remarks..."
          value={assessorVal}
          onChange={e => onAssessor(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100"
        />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <label className="text-[10px] font-bold text-gray-400 tracking-widest uppercase block mb-2">
          {assesseeLabel} Reflection / Comments
        </label>
        <textarea
          rows={5}
          placeholder="Self-reflection, questions, response to feedback..."
          value={assesseeVal}
          onChange={e => onAssessee(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100"
        />
      </div>
    </div>
  );
}

// ── Report generators ─────────────────────────────────────────────────────────
export function generateAssessmentReport(
  info: Record<string, string>,
  grades: Record<number, number>,
  assessorComments: string,
  assesseeComments: string,
) {
  const gradeColor = (g: number) =>
    g <= 0 ? "#dc2626" : g <= 2 ? "#d97706" : g <= 4 ? "#2563eb" : g === 5 ? "#0d9488" : "#16a34a";

  const sectionsHtml = ASSESSMENT_SECTIONS.map(section => {
    const gradedItems = section.items.filter(i => grades[i.num] !== undefined);
    const sAvg = gradedItems.length > 0
      ? gradedItems.reduce((a, i) => a + grades[i.num], 0) / gradedItems.length : null;
    const sLevel = sAvg !== null ? avgToLevel(sAvg) : "Not graded";
    const rows = section.items.map(item => {
      const g = grades[item.num];
      return g === undefined
        ? `<tr><td>${item.num}</td><td>${item.text}</td><td style="color:#999">—</td><td style="color:#999">Not graded</td></tr>`
        : `<tr><td>${item.num}</td><td>${item.text}</td><td style="font-weight:bold;color:${gradeColor(g)}">${g}</td><td style="color:${gradeColor(g)}">${GRADE_LABELS[g].level}</td></tr>`;
    }).join("");
    return `<div class="section">
      <div class="section-header">
        <span class="section-title">${section.title}</span>
        ${sAvg !== null ? `<span class="section-score">Average: <strong>${sAvg.toFixed(2)} / 6</strong> &nbsp;|&nbsp; <strong>${sLevel}</strong></span>` : `<span class="section-score">Not graded</span>`}
      </div>
      <table><thead><tr><th>#</th><th>Item</th><th>Grade</th><th>Level</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }).join("");

  const total = ASSESSMENT_SECTIONS.flatMap(s => s.items).length;
  const graded = Object.keys(grades).length;
  const avg = graded > 0 ? Object.values(grades).reduce((a, b) => a + b, 0) / graded : null;
  const level = avg !== null ? avgToLevel(avg) : "Incomplete";

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Nursing Assessment Audit Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#1a1a1a;padding:20mm;max-width:210mm;margin:auto}
h1{font-size:20pt;color:#0a2e38}.subtitle{font-size:11pt;color:#555;margin-top:4px}
.header{border-bottom:3px solid #0a2e38;padding-bottom:12px;margin-bottom:16px}
.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;background:#f5f9fa;border:1px solid #d1e8ec;border-radius:8px;padding:14px;margin-bottom:18px}
.info-item .lbl{font-size:8pt;text-transform:uppercase;color:#7a9da5;letter-spacing:.5px}
.info-item .val{font-size:11pt;font-weight:bold;color:#0a2e38;margin-top:2px}
.overall{background:#0a2e38;color:#fff;border-radius:8px;padding:16px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}
.overall-left p:first-child{font-size:9pt;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.5)}
.overall-left p:last-child{font-size:12pt;color:rgba(255,255,255,.8);margin-top:4px}
.overall-level{font-size:22pt;font-weight:bold;color:#5eead4}.overall-avg{font-size:12pt;color:rgba(255,255,255,.7);margin-top:4px;text-align:right}
.legend{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.legend-item{font-size:9pt;padding:2px 8px;border-radius:4px;font-weight:bold}
.section{margin-bottom:18px;page-break-inside:avoid}
.section-header{background:#e8f4f6;border-left:4px solid #0a2e38;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-radius:0 6px 6px 0}
.section-title{font-weight:bold;font-size:11pt;color:#0a2e38}.section-score{font-size:10pt;color:#444}
table{width:100%;border-collapse:collapse;margin-top:4px}
th{background:#f0f4f5;text-align:left;padding:5px 8px;font-size:9pt;color:#555;font-weight:bold}
td{padding:5px 8px;font-size:10pt;border-bottom:1px solid #eee;vertical-align:top}
td:first-child{font-weight:bold;color:#aaa;width:28px}td:nth-child(3){width:40px;text-align:center;font-weight:bold}td:nth-child(4){width:130px}
.comments{margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:16px;page-break-inside:avoid}
.comment-box{border:1px solid #ddd;border-radius:8px;padding:14px}
.comment-box .lbl{font-size:9pt;text-transform:uppercase;letter-spacing:.5px;color:#7a9da5;margin-bottom:8px;font-weight:bold}
.comment-box .body{font-size:10pt;color:#333;min-height:60px;white-space:pre-wrap}
.footer{margin-top:24px;text-align:center;font-size:9pt;color:#aaa;border-top:1px solid #eee;padding-top:10px}
@media print{body{padding:10mm}}
</style></head><body>
<div class="header"><h1>Nursing Assessment Audit</h1><p class="subtitle">Competen Healthcare · Clinical Competency Assessment Report</p></div>
<div class="info-grid">
  <div class="info-item"><div class="lbl">Nurse Assessed</div><div class="val">${info.nurse||'—'}</div></div>
  <div class="info-item"><div class="lbl">Assessor / Supervisor</div><div class="val">${info.assessor||'—'}</div></div>
  <div class="info-item"><div class="lbl">Unit / Ward</div><div class="val">${info.unit||'—'}</div></div>
  <div class="info-item"><div class="lbl">Date</div><div class="val">${info.date||'—'}</div></div>
  <div class="info-item"><div class="lbl">Co-worker Number</div><div class="val">${info.coworker||'—'}</div></div>
  <div class="info-item"><div class="lbl">Patient (de-identified)</div><div class="val">${info.patient||'—'}</div></div>
</div>
<div class="overall">
  <div class="overall-left"><p>Overall Competency Level</p><p>${graded} of ${total} items graded</p></div>
  <div><div class="overall-level">${level}</div>${avg !== null ? `<div class="overall-avg">Score: ${avg.toFixed(2)} / 6</div>` : ''}</div>
</div>
<div class="legend">
  <span class="legend-item" style="background:#fef2f2;color:#dc2626">0 — Novice</span>
  <span class="legend-item" style="background:#fffbeb;color:#d97706">1–2 — Advanced Beginner</span>
  <span class="legend-item" style="background:#eff6ff;color:#2563eb">3–4 — Competent</span>
  <span class="legend-item" style="background:#f0fdfa;color:#0d9488">5 — Proficient</span>
  <span class="legend-item" style="background:#f0fdf4;color:#16a34a">6 — Expert</span>
</div>
${sectionsHtml}
<div class="comments">
  <div class="comment-box"><div class="lbl">Assessor Comments</div><div class="body">${assessorComments||'No comments recorded.'}</div></div>
  <div class="comment-box"><div class="lbl">Nurse Reflection / Comments</div><div class="body">${assesseeComments||'No comments recorded.'}</div></div>
</div>
<div class="footer">Generated by Competen Healthcare · ${new Date().toLocaleString()} · This report is confidential.</div>
</body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 600); }
}

function generateMatchReport(
  auditTitle: string,
  info: Record<string, string>,
  infoFields: InfoField[],
  sections: { title: string; items: { num: number; text: string }[] }[],
  scores: Record<number, MatchValue>,
  yesLabel: string,
  noLabel: string,
  partialLabel: string,
  assessorComments: string,
  assesseeComments: string,
  assesseeLabel: string,
) {
  const yesC  = Object.values(scores).filter(v => v === "yes").length;
  const noC   = Object.values(scores).filter(v => v === "no").length;
  const partC = Object.values(scores).filter(v => v === "partial").length;
  const total = sections.flatMap(s => s.items).length;
  const answered = yesC + noC + partC;
  const overallPct = answered > 0 ? Math.round(((yesC + partC * 0.5) / total) * 100) : null;

  const markerColor = (v?: MatchValue) => v === "yes" ? "#16a34a" : v === "no" ? "#dc2626" : v === "partial" ? "#d97706" : "#999";
  const markerLabel = (v?: MatchValue) => v === "yes" ? yesLabel : v === "no" ? noLabel : v === "partial" ? partialLabel : "—";

  const sectionsHtml = sections.map(section => {
    const sYes  = section.items.filter(i => scores[i.num] === "yes").length;
    const sNo   = section.items.filter(i => scores[i.num] === "no").length;
    const sPart = section.items.filter(i => scores[i.num] === "partial").length;
    const sAns  = sYes + sNo + sPart;
    const sPct  = sAns > 0 ? Math.round(((sYes + sPart * 0.5) / section.items.length) * 100) : null;
    const rows  = section.items.map(item => {
      const v = scores[item.num];
      return `<tr><td>${item.num}</td><td>${item.text}</td><td style="color:${markerColor(v)};font-weight:bold">${markerLabel(v)}</td></tr>`;
    }).join("");
    return `<div class="section">
      <div class="section-header">
        <span class="section-title">${section.title}</span>
        ${sPct !== null ? `<span class="section-score"><strong>${sPct}%</strong> &nbsp;(✓ ${sYes} &nbsp;✗ ${sNo} &nbsp;~ ${sPart})</span>` : `<span class="section-score">Not reviewed</span>`}
      </div>
      <table><thead><tr><th>#</th><th>Item</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("");

  const infoHtml = infoFields.map(f =>
    `<div class="info-item"><div class="lbl">${f.label}</div><div class="val">${info[f.key]||'—'}</div></div>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${auditTitle} Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#1a1a1a;padding:20mm;max-width:210mm;margin:auto}
h1{font-size:20pt;color:#0a2e38}.subtitle{font-size:11pt;color:#555;margin-top:4px}
.header{border-bottom:3px solid #0a2e38;padding-bottom:12px;margin-bottom:16px}
.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;background:#f5f9fa;border:1px solid #d1e8ec;border-radius:8px;padding:14px;margin-bottom:18px}
.info-item .lbl{font-size:8pt;text-transform:uppercase;color:#7a9da5;letter-spacing:.5px}
.info-item .val{font-size:11pt;font-weight:bold;color:#0a2e38;margin-top:2px}
.overall{background:#0a2e38;color:#fff;border-radius:8px;padding:16px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}
.overall-left p:first-child{font-size:9pt;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.5)}
.overall-left p:last-child{font-size:12pt;color:rgba(255,255,255,.8);margin-top:4px}
.overall-pct{font-size:28pt;font-weight:bold;color:#5eead4}
.section{margin-bottom:18px;page-break-inside:avoid}
.section-header{background:#e8f4f6;border-left:4px solid #0a2e38;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-radius:0 6px 6px 0}
.section-title{font-weight:bold;font-size:11pt;color:#0a2e38}.section-score{font-size:10pt;color:#444}
table{width:100%;border-collapse:collapse;margin-top:4px}
th{background:#f0f4f5;text-align:left;padding:5px 8px;font-size:9pt;color:#555;font-weight:bold}
td{padding:5px 8px;font-size:10pt;border-bottom:1px solid #eee;vertical-align:top}
td:first-child{font-weight:bold;color:#aaa;width:28px}td:last-child{width:90px}
.comments{margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:16px;page-break-inside:avoid}
.comment-box{border:1px solid #ddd;border-radius:8px;padding:14px}
.comment-box .lbl{font-size:9pt;text-transform:uppercase;letter-spacing:.5px;color:#7a9da5;margin-bottom:8px;font-weight:bold}
.comment-box .body{font-size:10pt;color:#333;min-height:60px;white-space:pre-wrap}
.footer{margin-top:24px;text-align:center;font-size:9pt;color:#aaa;border-top:1px solid #eee;padding-top:10px}
@media print{body{padding:10mm}}
</style></head><body>
<div class="header"><h1>${auditTitle}</h1><p class="subtitle">Competen Healthcare · Clinical Audit Report</p></div>
<div class="info-grid">${infoHtml}</div>
<div class="overall">
  <div class="overall-left">
    <p>Overall Score</p>
    <p>${answered} of ${total} items reviewed &nbsp;·&nbsp; ✓ ${yesC} ${yesLabel} &nbsp;·&nbsp; ✗ ${noC} ${noLabel} &nbsp;·&nbsp; ~ ${partC} ${partialLabel}</p>
  </div>
  <div class="overall-pct">${overallPct !== null ? overallPct + '%' : '—'}</div>
</div>
${sectionsHtml}
<div class="comments">
  <div class="comment-box"><div class="lbl">Assessor / Auditor Comments</div><div class="body">${assessorComments||'No comments recorded.'}</div></div>
  <div class="comment-box"><div class="lbl">${assesseeLabel} Reflection / Comments</div><div class="body">${assesseeComments||'No comments recorded.'}</div></div>
</div>
<div class="footer">Generated by Competen Healthcare · ${new Date().toLocaleString()} · This report is confidential.</div>
</body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 600); }
}

// ── Concurrent & Chart Audit (Sheets 2 & 3) ──────────────────────────────────
export function MatchAudit({
  sections, title, howToUse,
  yesLabel = "Yes", noLabel = "No", partialLabel = "Partial",
  infoFields, assesseeLabel,
}: {
  sections: { title: string; items: { num: number; text: string }[] }[];
  title: string; description: string; howToUse: string;
  yesLabel?: string; noLabel?: string; partialLabel?: string;
  infoFields: InfoField[]; assesseeLabel: string;
}) {
  const allItems = sections.flatMap(s => s.items);
  const [scores, setScores]           = useState<Record<number, MatchValue>>({});
  const [collapsed, setCollapsed]     = useState<Set<string>>(new Set());
  const [info, setInfo]               = useState<Record<string, string>>({});
  const [assessorComments, setAssessorComments] = useState("");
  const [assesseeComments, setAssesseeComments] = useState("");

  const setScore = (num: number, v: MatchValue) =>
    setScores(prev => {
      if (prev[num] === v) { const rest = { ...prev }; delete rest[num]; return rest; }
      return { ...prev, [num]: v };
    });

  const totalItems = allItems.length;
  const answered   = Object.keys(scores).length;
  const yesCount   = Object.values(scores).filter(v => v === "yes").length;
  const noCount    = Object.values(scores).filter(v => v === "no").length;
  const partCount  = Object.values(scores).filter(v => v === "partial").length;
  const compliance = answered > 0 ? Math.round(((yesCount + partCount * 0.5) / totalItems) * 100) : null;

  const toggleSection = (t: string) =>
    setCollapsed(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  const btnStyle = (num: number, v: MatchValue) => {
    const active = scores[num] === v;
    if (v === "yes")     return active ? "bg-green-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-green-50 hover:text-green-700";
    if (v === "no")      return active ? "bg-red-500 text-white"   : "bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-700";
    return active ? "bg-amber-400 text-white" : "bg-gray-100 text-gray-500 hover:bg-amber-50 hover:text-amber-700";
  };

  const getSectionPct = (section: typeof sections[0]) => {
    const sYes  = section.items.filter(i => scores[i.num] === "yes").length;
    const sNo   = section.items.filter(i => scores[i.num] === "no").length;
    const sPart = section.items.filter(i => scores[i.num] === "partial").length;
    const sAns  = sYes + sNo + sPart;
    return { sYes, sNo, sPart, pct: sAns > 0 ? Math.round(((sYes + sPart * 0.5) / section.items.length) * 100) : null };
  };

  return (
    <div>
      <InfoFields fields={infoFields} values={info} onChange={(k, v) => setInfo(prev => ({ ...prev, [k]: v }))} />

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5 text-sm text-blue-800">
        <strong>How to use:</strong> {howToUse}
      </div>

      {/* Overall banner */}
      <div className="bg-[#0a2e38] rounded-xl p-5 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-teal-300/70 text-xs font-semibold uppercase tracking-widest mb-1">{title}</p>
          <p className="text-teal-200 text-sm">{answered} of {totalItems} items reviewed</p>
          <div className="flex items-center gap-4 mt-1 text-xs">
            <span className="text-green-400">✓ {yesLabel}: {yesCount}</span>
            <span className="text-red-400">✗ {noLabel}: {noCount}</span>
            <span className="text-amber-400">~ {partialLabel}: {partCount}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {compliance !== null ? (
            <span className={`text-2xl font-bold ${compliance >= 80 ? "text-green-400" : compliance >= 60 ? "text-amber-400" : "text-red-400"}`}>
              {compliance}%
            </span>
          ) : (
            <span className="text-teal-400/50 text-sm">Score appears here</span>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => generateMatchReport(title, info, infoFields, sections, scores, yesLabel, noLabel, partialLabel, assessorComments, assesseeComments, assesseeLabel)}
              disabled={answered === 0}
              className="text-xs bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors">
              Generate Report
            </button>
            <button onClick={() => setScores({})} className="text-xs text-teal-400 hover:text-white border border-teal-700 px-3 py-1.5 rounded-lg transition-colors">
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Overall progress bar */}
      {compliance !== null && (
        <div className="mb-5">
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${compliance >= 80 ? "bg-green-500" : compliance >= 60 ? "bg-amber-400" : "bg-red-400"}`}
              style={{ width: `${compliance}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {compliance >= 80 ? `${compliance}% — Good` : compliance >= 60 ? `${compliance}% — Needs attention` : `${compliance}% — Significant gaps`}
          </p>
        </div>
      )}

      {/* Sections */}
      <div className="flex flex-col gap-3">
        {sections.map(section => {
          const isOpen = !collapsed.has(section.title);
          const { sYes, sNo, sPart, pct } = getSectionPct(section);

          return (
            <div key={section.title} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <button onClick={() => toggleSection(section.title)}
                className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50 transition-colors">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{section.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {sYes > 0 && <span className="text-green-600 mr-2">✓{sYes}</span>}
                    {sNo  > 0 && <span className="text-red-500 mr-2">✗{sNo}</span>}
                    {sPart > 0 && <span className="text-amber-600 mr-2">~{sPart}</span>}
                    {section.items.length} items
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {pct !== null && (
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                      pct >= 80 ? "bg-green-100 text-green-700 border-green-200"
                      : pct >= 60 ? "bg-amber-100 text-amber-700 border-amber-200"
                      : "bg-red-100 text-red-700 border-red-200"
                    }`}>{pct}%</span>
                  )}
                  <span className="text-gray-400 text-sm">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                  {section.items.map(item => (
                    <div key={item.num} className={`px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${
                      scores[item.num] === "no" ? "bg-red-50/40" : scores[item.num] === "yes" ? "bg-green-50/30" : scores[item.num] === "partial" ? "bg-amber-50/40" : ""
                    }`}>
                      <div className="flex-1">
                        <span className="text-[10px] font-bold text-gray-400 mr-2">{item.num}.</span>
                        <span className="text-sm text-gray-800">{item.text}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {(["yes", "no", "partial"] as MatchValue[]).map(v => (
                          <button key={v} onClick={() => setScore(item.num, v)}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${btnStyle(item.num, v)}`}>
                            {v === "yes" ? `✓ ${yesLabel}` : v === "no" ? `✗ ${noLabel}` : `~ ${partialLabel}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Section score summary row */}
                  {pct !== null && (
                    <div className={`px-5 py-3 flex items-center justify-between border-t-2 ${
                      pct >= 80 ? "border-green-200 bg-green-50/60"
                      : pct >= 60 ? "border-amber-200 bg-amber-50/60"
                      : "border-red-200 bg-red-50/60"
                    }`}>
                      <span className="text-xs font-semibold text-gray-500">Section Score</span>
                      <span className={`text-sm font-bold px-3 py-1 rounded-lg border ${
                        pct >= 80 ? "bg-green-100 text-green-700 border-green-200"
                        : pct >= 60 ? "bg-amber-100 text-amber-700 border-amber-200"
                        : "bg-red-100 text-red-700 border-red-200"
                      }`}>{pct}% &nbsp;·&nbsp; ✓{sYes} ✗{sNo} ~{sPart}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <CommentsSection
        assessorVal={assessorComments}
        assesseeLabel={assesseeLabel}
        assesseeVal={assesseeComments}
        onAssessor={setAssessorComments}
        onAssessee={setAssesseeComments}
      />
    </div>
  );
}

