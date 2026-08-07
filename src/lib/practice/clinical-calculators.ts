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
// ⚠ THIS FILE USED TO SAY "NO DOSING CALCULATORS" AND IT NO LONGER DOES. READ WHAT CHANGED AND WHAT
//   DID NOT, BECAUSE THE DIFFERENCE IS THE WHOLE SAFETY ARGUMENT.
//
// The refusal, verbatim, as it stood until CPR-MED-001 was built:
//
//   "NO DOSING CALCULATORS. Not an oversight and not a scope cut. A calculator that computes a dose is
//    one where an error is directly a harm, and getting it right needs a drug database, a route, a renal
//    adjustment and an indication -- none of which this product has."
//
// It named four preconditions. EXACTLY ZERO OF THE FOUR HAVE BEEN MET. There is still no drug database,
// no route semantics, no renal adjustment and no indication vocabulary in this product. What changed is
// something the refusal did not mention and could not have: CPR-LCP-001 shipped on migration 246, so a
// patient's WEIGHT is now a recorded, timestamped, citable measurement rather than a number somebody
// remembers. MED-001 s3 asks for mg/kg arithmetic over exactly that.
//
// So the resolution is a split, and it is the user's scope decision of 2026-08-07:
//
//   THE ARITHMETIC IS BUILT.   doseArithmetic() multiplies a dose the user typed by a weight this record
//                              holds, and returns every step of the multiplication as text.
//   THE SAFETY CLAIM IS NOT.   There is no maximum, no minimum, no licensed age range, no interaction
//                              and no organ-function adjustment behind the number, and MED-001 s4's
//                              eight checks that would need them are deferred and rendered on screen by
//                              name in the words "not checked".
//
// ⚠ A STALE REFUSAL READ AS A DECISION IS A BUG. This paragraph exists so that the next person to open
//   this file learns which half of the old sentence survived rather than deleting a warning that is
//   still true or honouring one that is not. The surviving half is in medication-constants.ts as
//   doseSafetyNotice(), and no screen may print a computed dose without it.
//
// Everything here is still ARITHMETIC ON NUMBERS THE USER TYPED (or, for a dose, on one number the user
// typed and one number this record can cite), with a published formula named in the code.
//
// NO INTERPRETATION EITHER. BMI is returned as a number; whether 31 means anything for this patient is a
// clinical judgement about a person the product has not met. A category printed beside it would read as
// advice. The same applies to a dose: the figure is what the multiplication says, not what is right.
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

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-MED-001 s3 -- THE DOSE ARITHMETIC
//
// s3 verbatim: "Weight-based (mg/kg) / Daily dose (mg/kg/day) / Body surface area (mg/m2) / Fixed-dose
// regimens / Dose/unit conversions / TRANSPARENT CALCULATION DISPLAY."
//
// The last of those six is the one that makes the other five defensible, so it is not a rendering
// preference here -- it is the return type. Every result carries `working`, a line per step, and the
// database column that stores it is NOT NULL with a non-empty check. A dose figure with no working
// beside it is exactly the "eGFR 43" problem this file's header opens with, in the one domain where an
// error is directly a harm.
//
// ⚠ THIS FUNCTION IS NOT A SAFETY CHECK AND MUST NEVER BE PRESENTED AS ONE. It knows nothing about the
//   drug. Print doseSafetyNotice() from medication-constants.ts beside every figure it returns.
//
// ⚠ AND IT REFUSES RATHER THAN GUESSES, IN BOTH DIRECTIONS THAT MATTER:
//   - No weight, no dose. LCP-001 s9: "A weight-dependent paediatric dose requires a usable dosing
//     weight." A weight-based calculation with an assumed weight is the single worst output this file
//     could produce, so an absent weight returns ok:false with the reason, never a number.
//   - No doses-per-day, no per-dose figure for a mg/kg/day regimen. "40 mg/kg/day" divided by a
//     frequency nobody stated is a per-dose number invented by this code. The daily total is returned
//     and the per-dose figure is withheld, with a sentence saying which is which.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type DoseBasis = "mg_per_kg" | "mg_per_kg_per_day" | "mg_per_m2" | "fixed";

export type DoseResult =
  | {
    ok: true;
    basis: DoseBasis;
    /** The dose for ONE administration. Null for a daily regimen with no stated frequency. */
    perDose: number | null;
    /** The total across twenty-four hours. Only ever set for a mg/kg/day regimen. */
    dailyTotal: number | null;
    unit: string;
    /** The named formula, as it would be written down. */
    formula: string;
    /** ⚠ EVERY STEP, IN ORDER. This is the transparency s3 asks for and it is never empty. */
    working: string[];
    /** The one-line version, for a note. Carries its inputs, like every other sentence in this file. */
    sentence: string;
    /** The Mosteller BSA this calculation used, when it used one. */
    bsaM2: number | null;
  }
  | { ok: false; message: string };

/**
 * @param dosePerUnit  mg/kg, mg/kg/day or mg/m2, as typed by the prescriber. Ignored for `fixed`.
 * @param fixedDose    the stated dose, for `fixed`. Ignored otherwise.
 * @param weightKg     from a recorded measurement. NOT typed, NOT remembered, NOT carried forward.
 * @param heightCm     from a recorded measurement. Only used by mg/m2.
 * @param dosesPerDay  how many administrations a day. Only used by mg/kg/day, and withheld when absent.
 * @param unit         the dose unit, echoed rather than converted. See the note on conversions below.
 */
export function doseArithmetic(input: {
  basis: DoseBasis;
  dosePerUnit: number | null;
  fixedDose?: number | null;
  weightKg: number | null;
  heightCm?: number | null;
  dosesPerDay?: number | null;
  unit?: string | null;
}): DoseResult {
  const unit = (input.unit ?? "mg").trim() || "mg";
  const weight = input.weightKg;
  const rate = input.dosePerUnit;

  if (input.basis === "fixed") {
    const fixed = input.fixedDose ?? null;
    if (fixed === null || !Number.isFinite(fixed) || fixed <= 0)
      return { ok: false, message: "a fixed dose needs a dose" };
    return {
      ok: true, basis: "fixed", perDose: round(fixed, 3), dailyTotal: null, unit,
      formula: "stated dose",
      // ⚠ THE WORKING IS NOT EMPTY EVEN THOUGH THERE IS NO ARITHMETIC, and that is deliberate. A screen
      // that showed working for three regimens and a blank for the fourth would read as a step somebody
      // skipped. Saying "no calculation was performed" is the working.
      working: [
        `Fixed-dose regimen: no calculation was performed.`,
        `The dose is ${round(fixed, 3)} ${unit} as stated, and does not depend on this patient's weight or size.`,
      ],
      sentence: `${round(fixed, 3)} ${unit} (fixed dose, no calculation performed).`,
      bsaM2: null,
    };
  }

  if (rate === null || !Number.isFinite(rate) || rate <= 0)
    return { ok: false, message: "a dose rate is required (for example 15 mg/kg)" };

  if (input.basis === "mg_per_kg" || input.basis === "mg_per_kg_per_day") {
    // ⚠ NO WEIGHT, NO NUMBER. LCP-001 s9. This branch is the reason the function returns a discriminated
    // union rather than a nullable number: a caller cannot accidentally render `null` as a dose.
    if (weight === null || !Number.isFinite(weight) || weight <= 0)
      return {
        ok: false,
        message: "no usable weight is recorded for this patient, so a weight-based dose cannot be computed. Record a weight, or prescribe on a basis that does not need one.",
      };
    if (weight < 0.4 || weight > 500)
      return { ok: false, message: `a weight of ${weight} kg is outside the range this calculator will accept (0.4 to 500). Check the recorded measurement before prescribing on it.` };

    if (input.basis === "mg_per_kg") {
      const perDose = round(rate * weight, 3);
      return {
        ok: true, basis: "mg_per_kg", perDose, dailyTotal: null, unit,
        formula: "dose per kilogram x weight (kg)",
        working: [
          `Rate: ${rate} ${unit}/kg`,
          `Weight: ${weight} kg (from the recorded measurement cited beside this calculation)`,
          `${rate} ${unit}/kg x ${weight} kg = ${perDose} ${unit}`,
          `That is ONE dose. It is not a daily total.`,
        ],
        sentence: `${perDose} ${unit} per dose (${rate} ${unit}/kg x ${weight} kg).`,
        bsaM2: null,
      };
    }

    const daily = round(rate * weight, 3);
    const perDay = input.dosesPerDay ?? null;
    const working = [
      `Rate: ${rate} ${unit}/kg/day`,
      `Weight: ${weight} kg (from the recorded measurement cited beside this calculation)`,
      `${rate} ${unit}/kg/day x ${weight} kg = ${daily} ${unit} per day`,
    ];
    if (perDay === null || !Number.isFinite(perDay) || perDay <= 0) {
      // ⚠ THE DAILY TOTAL IS RETURNED AND THE PER-DOSE FIGURE IS WITHHELD. Dividing by a frequency
      // nobody stated would produce a per-dose number this code invented, and it would look exactly
      // like one somebody decided.
      working.push(`How many doses a day has not been stated, so the per-dose figure is NOT computed. ${daily} ${unit} is the total across twenty-four hours.`);
      return {
        ok: true, basis: "mg_per_kg_per_day", perDose: null, dailyTotal: daily, unit,
        formula: "dose per kilogram per day x weight (kg)",
        working,
        sentence: `${daily} ${unit} per day (${rate} ${unit}/kg/day x ${weight} kg). Per-dose figure not computed: the number of doses a day is not stated.`,
        bsaM2: null,
      };
    }
    const perDose = round(daily / perDay, 3);
    working.push(`${daily} ${unit} per day divided by ${perDay} dose${perDay === 1 ? "" : "s"} a day = ${perDose} ${unit} per dose`);
    return {
      ok: true, basis: "mg_per_kg_per_day", perDose, dailyTotal: daily, unit,
      formula: "dose per kilogram per day x weight (kg), divided by doses per day",
      working,
      sentence: `${daily} ${unit} per day in ${perDay} dose${perDay === 1 ? "" : "s"} = ${perDose} ${unit} per dose (${rate} ${unit}/kg/day x ${weight} kg).`,
      bsaM2: null,
    };
  }

  // mg/m2. BSA is Mosteller, computed HERE BY THE SAME FUNCTION the BSA calculator above uses, so the
  // two can never disagree -- the alternative was a second square root in a second file.
  const height = input.heightCm ?? null;
  if (weight === null || height === null)
    return {
      ok: false,
      message: "body surface area needs both a recorded weight and a recorded height for this patient, and at least one is missing.",
    };
  const bsaResult = calculatorByKey("bsa")!.compute({ weight: String(weight), height: String(height) });
  if (!bsaResult.ok) return { ok: false, message: bsaResult.message };
  const bsa = bsaResult.value;
  const perDose = round(rate * bsa, 3);
  return {
    ok: true, basis: "mg_per_m2", perDose, dailyTotal: null, unit,
    formula: "dose per square metre x body surface area (Mosteller)",
    working: [
      `Rate: ${rate} ${unit}/m2`,
      `Weight: ${weight} kg, height: ${height} cm (both from recorded measurements cited beside this calculation)`,
      `BSA (Mosteller) = sqrt(${height} x ${weight} / 3600) = ${bsa} m2`,
      `${rate} ${unit}/m2 x ${bsa} m2 = ${perDose} ${unit}`,
      `That is ONE dose. It is not a daily total.`,
    ],
    sentence: `${perDose} ${unit} per dose (${rate} ${unit}/m2 x BSA ${bsa} m2, Mosteller from ${weight} kg and ${height} cm).`,
    bsaM2: bsa,
  };
}

/**
 * ⚠ THERE IS NO UNIT CONVERSION HERE AND s3's "Dose/unit conversions" IS ANSWERED SOMEWHERE ELSE.
 *
 * MED-001 s3 lists dose and unit conversions. The conversion that this product can do correctly is the
 * one CPR-LCP-001 already built: migration 246 gives every parameter a canonical unit, a permitted-unit
 * list and a `unit_conversions` table of multipliers, and toCanonical() in parameters.ts applies it. So a
 * weight entered in pounds reaches this function in kilograms, converted by data rather than by code.
 *
 * The conversion this file will NOT do is between DOSE units -- mg to micrograms to millimoles to
 * international units. Milligrams and micrograms differ by a thousand, an IU is drug-specific and has no
 * general mass equivalent at all, and a converter that guessed from the magnitude would be wrong exactly
 * at the boundary where it matters. This is the same rule the eGFR calculator states about creatinine:
 * UNITS ARE NEVER GUESSED. The dose unit is echoed, never transformed.
 */
export const DOSE_UNIT_CONVERSION_REFUSED =
  "Dose units are echoed, never converted. Milligrams and micrograms differ by a thousand and an "
  + "international unit has no general mass equivalent, so a converter that inferred the unit would be "
  + "wrong exactly where it matters. Weight and height reach this calculation already converted to their "
  + "canonical units by the parameter engine, which converts from a stored table rather than by guessing.";
