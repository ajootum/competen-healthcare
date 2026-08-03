// CPR-130 CLINICAL CALCULATORS (s3 "Clinical calculators integration"; the comp's "Open calculator").
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// EVERY RESULT CARRIES ITS INPUTS INTO THE NOTE. NOT AS A CONVENIENCE -- AS THE SAFETY PROPERTY.
//
// "eGFR 43" in a clinical record is unverifiable: a reader cannot tell whether the creatinine was in
// mg/dL or umol/L, whether the age was right, or whether the person who typed it used this calculator at
// all. "eGFR 43 mL/min/1.73m2 (CKD-EPI 2021; creatinine 1.60 mg/dL, age 62, female)" can be checked by
// anybody, including the person who wrote it, six months later.
//
// So insertion is never the bare number. Every calculator returns a `sentence` and that is what reaches
// the note.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NO DOSING CALCULATORS. Not an oversight and not a scope cut. A calculator that computes a dose is one
// where an error is directly a harm, and getting it right needs a drug database, a route, a renal
// adjustment and an indication -- none of which this product has. Every calculator here is ARITHMETIC ON
// NUMBERS THE USER TYPED, with a published formula named in the code.
//
// NO INTERPRETATION EITHER. BMI is returned as a number; whether 31 means anything for this patient is a
// clinical judgement about a person the product has not met. A category printed beside it would read as
// advice.
//
// UNITS ARE NEVER GUESSED. Creatinine in mg/dL and in umol/L differ by a factor of 88.4, and a
// calculator that inferred the unit from the magnitude would be wrong exactly at the boundary where it
// matters. The unit is a required input.

export type CalculatorField = {
  key: string; label: string; unit?: string; kind: "number" | "select";
  options?: readonly (readonly [string, string])[];
  min?: number; max?: number; step?: number;
};

export type CalculatorResult =
  | { ok: true; value: number; unit: string; sentence: string }
  | { ok: false; message: string };

export type Calculator = {
  key: string; name: string; formula: string;
  fields: readonly CalculatorField[];
  compute: (input: Record<string, string>) => CalculatorResult;
};

const num = (input: Record<string, string>, key: string): number | null => {
  const raw = (input[key] ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Rounded for display only; the check below is against the raw value, so a bound is never rounded into. */
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

const require_ = (
  values: Record<string, number | null>, bounds: Record<string, [number, number, string]>,
): string | null => {
  for (const [key, v] of Object.entries(values)) {
    const [min, max, label] = bounds[key];
    if (v === null) return `${label} is required`;
    // PLAUSIBILITY BOUNDS, NOT CLINICAL ONES. They catch a decimal point in the wrong place -- a 7 kg
    // adult, a 1.7 cm height -- and nothing else. A bound that refused an unusual but real patient
    // would be the calculator overruling the clinician.
    if (v < min || v > max) return `${label} of ${v} is outside the range this calculator will accept (${min} to ${max})`;
  }
  return null;
};

export const CALCULATORS: readonly Calculator[] = [
  {
    key: "bmi",
    name: "Body mass index",
    formula: "weight (kg) / height (m)^2",
    fields: [
      { key: "weight", label: "Weight", unit: "kg", kind: "number", min: 0.5, max: 500, step: 0.1 },
      { key: "height", label: "Height", unit: "cm", kind: "number", min: 20, max: 260, step: 0.5 },
    ],
    compute(input) {
      const weight = num(input, "weight"), height = num(input, "height");
      const bad = require_({ weight, height }, {
        weight: [0.5, 500, "Weight"], height: [20, 260, "Height"],
      });
      if (bad) return { ok: false, message: bad };

      const metres = height! / 100;
      const value = round(weight! / (metres * metres), 1);
      return {
        ok: true, value, unit: "kg/m2",
        // No category. See the header.
        sentence: `BMI ${value} kg/m2 (weight ${weight} kg, height ${height} cm).`,
      };
    },
  },
  {
    key: "bsa",
    name: "Body surface area (Mosteller)",
    formula: "sqrt(height (cm) * weight (kg) / 3600)",
    fields: [
      { key: "weight", label: "Weight", unit: "kg", kind: "number", min: 0.5, max: 500, step: 0.1 },
      { key: "height", label: "Height", unit: "cm", kind: "number", min: 20, max: 260, step: 0.5 },
    ],
    compute(input) {
      const weight = num(input, "weight"), height = num(input, "height");
      const bad = require_({ weight, height }, {
        weight: [0.5, 500, "Weight"], height: [20, 260, "Height"],
      });
      if (bad) return { ok: false, message: bad };

      const value = round(Math.sqrt((height! * weight!) / 3600), 2);
      return {
        ok: true, value, unit: "m2",
        sentence: `BSA ${value} m2 (Mosteller; weight ${weight} kg, height ${height} cm).`,
      };
    },
  },
  {
    key: "map",
    name: "Mean arterial pressure",
    formula: "diastolic + (systolic - diastolic) / 3",
    fields: [
      { key: "systolic", label: "Systolic", unit: "mmHg", kind: "number", min: 40, max: 300, step: 1 },
      { key: "diastolic", label: "Diastolic", unit: "mmHg", kind: "number", min: 10, max: 200, step: 1 },
    ],
    compute(input) {
      const systolic = num(input, "systolic"), diastolic = num(input, "diastolic");
      const bad = require_({ systolic, diastolic }, {
        systolic: [40, 300, "Systolic"], diastolic: [10, 200, "Diastolic"],
      });
      if (bad) return { ok: false, message: bad };
      // A diastolic above the systolic is a transcription error, not a patient. Refused rather than
      // computed, because the arithmetic would happily return a plausible-looking number.
      if (diastolic! >= systolic!)
        return { ok: false, message: "the diastolic is not below the systolic; check the reading" };

      const value = round(diastolic! + (systolic! - diastolic!) / 3, 0);
      return {
        ok: true, value, unit: "mmHg",
        sentence: `MAP ${value} mmHg (from ${systolic}/${diastolic} mmHg).`,
      };
    },
  },
  {
    key: "egfr",
    name: "eGFR (CKD-EPI 2021, creatinine)",
    // The 2021 race-free CKD-EPI creatinine equation (Inker et al., NEJM 2021):
    //   eGFR = 142 * min(Scr/k, 1)^a * max(Scr/k, 1)^-1.200 * 0.9938^age * (1.012 if female)
    //   where k = 0.7 (female) or 0.9 (male), a = -0.241 (female) or -0.302 (male), Scr in mg/dL.
    formula: "CKD-EPI 2021 creatinine equation (race-free)",
    fields: [
      { key: "creatinine", label: "Creatinine", kind: "number", min: 0.05, max: 2500, step: 0.01 },
      {
        key: "unit", label: "Creatinine unit", kind: "select",
        options: [["mg_dl", "mg/dL"], ["umol_l", "umol/L"]] as const,
      },
      { key: "age", label: "Age", unit: "years", kind: "number", min: 18, max: 120, step: 1 },
      { key: "sex", label: "Sex", kind: "select", options: [["female", "Female"], ["male", "Male"]] as const },
    ],
    compute(input) {
      const creatinine = num(input, "creatinine"), age = num(input, "age");
      const unit = input.unit, sex = input.sex;

      if (unit !== "mg_dl" && unit !== "umol_l")
        return { ok: false, message: "choose the unit the creatinine was reported in" };
      if (sex !== "female" && sex !== "male")
        return { ok: false, message: "sex is required by this equation" };

      const bad = require_({ creatinine, age }, {
        creatinine: [0.05, 2500, "Creatinine"], age: [18, 120, "Age"],
      });
      if (bad) return { ok: false, message: bad };

      // THE EQUATION IS DEFINED FOR ADULTS. A paediatric eGFR needs a different one (Schwartz), and
      // returning an adult number for a child would be a wrong answer that looks like a right one.
      // Enforced by the age bound above; said here so the reason is not lost.

      const mgdl = unit === "umol_l" ? creatinine! / 88.4 : creatinine!;
      const female = sex === "female";
      const k = female ? 0.7 : 0.9;
      const a = female ? -0.241 : -0.302;

      const value = round(
        142
        * Math.pow(Math.min(mgdl / k, 1), a)
        * Math.pow(Math.max(mgdl / k, 1), -1.200)
        * Math.pow(0.9938, age!)
        * (female ? 1.012 : 1),
        0,
      );

      const reported = unit === "umol_l" ? `${creatinine} umol/L` : `${creatinine} mg/dL`;
      return {
        ok: true, value, unit: "mL/min/1.73m2",
        sentence: `eGFR ${value} mL/min/1.73m2 (CKD-EPI 2021; creatinine ${reported}, age ${age}, ${sex}).`,
      };
    },
  },
] as const;

export const calculatorByKey = (key: string) => CALCULATORS.find(c => c.key === key) ?? null;
