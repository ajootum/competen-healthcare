import { createHash } from "node:crypto";
import type { WorkspaceContext } from "./access";
import { register } from "./registration";
import { screenRegistration, type Candidate } from "./patients";
import { bookAppointment } from "./scheduling";
import { RELATIONSHIP_TYPES, GUARDIAN_TYPES, MAJORITY_AGE } from "./relationships";
import { audit } from "./audit";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS, MAX_IMPORT_BYTES } from "./import-columns";
import { instantInZone } from "./practice-time";

/* eslint-disable @typescript-eslint/no-explicit-any */

// CPR-IMP-001 -- bulk patient import from a CSV, for practices moving an existing register in.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS FILE DECIDES NOTHING ABOUT A PATIENT. Every judgement -- the minimum dataset, the duplicate
// doctrine, the guardian rule, the booking rules -- belongs to the engines the registration screen
// already uses, and the import calls those engines row by row: screenRegistration() to look,
// register() to write, bookAppointment() to book. A rule restated here would be a rule that could
// disagree with the form, and a hospital number on two records is how that disagreement ends.
//
// THE TWO SETTLED DECISIONS (the owner, 2026-08-11):
//   1. A row that matches an existing patient is SKIPPED AND REPORTED with the candidates -- the CSV
//      is never allowed to answer the question the screen gives a human ("search first").
//   2. A row whose appointment cannot be honoured still REGISTERS THE PATIENT: the appointment is
//      dropped and the report says exactly why. A bad time never costs a record its migration.
//
// IDEMPOTENCY (CPR-ARCH-001): a file whose sha256 already completed for this workspace is refused
// whole, and a row whose external_id already created a patient here is skipped -- the second layer is
// a unique index (migration 288), not a promise. Rows without an external id fall back to the same
// duplicate screening a typed registration gets.
//
// PROVENANCE (CPR-DM-001 s15): the practice_import_row ledger IS the provenance record -- which run,
// which file, which row, which external key produced which patient. See migration 288.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

// The columns and caps live in import-columns.ts (imports-nothing, shared with the client template).
export { IMPORT_COLUMNS, MAX_IMPORT_ROWS, MAX_IMPORT_BYTES };

const SEX_VALUES = new Map([
  ["female", "female"], ["f", "female"],
  ["male", "male"], ["m", "male"],
  ["other", "other"], ["unknown", "unknown"], ["unspecified", "unspecified"],
]);

const APPOINTMENT_TYPES = new Set([
  "new_consultation", "scheduled_followup", "walk_in", "emergency",
  "hospital_consultation", "teleconsultation", "home_visit",
]);

const RELATIONSHIP_CODES = new Set<string>(RELATIONSHIP_TYPES.map(([code]) => code));

export type ImportFields = {
  firstName?: string; middleName?: string; lastName?: string;
  dateOfBirth?: string; estimatedAge?: number; sex?: string;
  phone?: string; email?: string; nationalId?: string;
  guardianName?: string; guardianRelationship?: string; guardianPhone?: string; guardianEmail?: string;
  reasonForVisit?: string;
  location?: string; appointmentDate?: string; appointmentTime?: string; appointmentType?: string;
  externalId?: string;
};

export type ParsedRow = {
  rowNumber: number;               // 1-based DATA row number (header is row 0)
  fields: ImportFields;
  /** Problems that stop the PERSON being registered. */
  problems: string[];
  /** Problems that only drop the APPOINTMENT (decision 2: the person still registers). */
  appointmentProblems: string[];
  /** Announcements, not problems: how an ambiguous value was read (the day-first convention). */
  notes: string[];
  /** True when appointment_date/time were supplied at all. */
  wantsAppointment: boolean;
};

export type ParseResult = {
  rows: ParsedRow[];
  /** File-level problems: unknown headers, row cap, unreadable lines. */
  fileProblems: string[];
};

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────
// A small RFC-4180 reader rather than a dependency: quoted fields, doubled-quote escapes, CRLF or LF.
// A malformed line becomes a named file problem, never a silently mangled patient.

function splitCsvLine(line: string, lineNo: number, fileProblems: string[]): string[] | null {
  const out: string[] = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  if (inQuotes) {
    fileProblems.push(`line ${lineNo}: an opening quote is never closed, so the line cannot be read`);
    return null;
  }
  out.push(cur);
  return out;
}

const canon = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");

// ── Dates and times, as people actually type them ──────────────────────────────────────────────────
// A migrated spreadsheet rarely carries ISO dates. The rules (the owner, 2026-08-11, incl. "e.g.
// dd-mm-yyyy"): ISO, written-month forms, and all-numeric dates read DAY FIRST -- dd-mm-yyyy is the
// declared convention of this import, stated on the screen, in the spec and in every error message.
// The one genuine ambiguity (day <= 12, where 03-04-1988 could be either) is not guessed silently:
// the day-first reading is APPLIED and ANNOUNCED -- a note at preview and in the ledger says exactly
// how the date was read, so a month-first file is caught by a human at the preview instead of
// discovered in a birthday years later. A month-first file with any day over 12 refuses itself
// loudly (month 13 does not exist). Two-digit years are refused: a century is not guessable.

const MONTH_NAMES = new Map<string, number>([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["sept", 9], ["oct", 10], ["nov", 11], ["dec", 12],
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["june", 6], ["july", 7],
  ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12],
]);

const HOW_TO_DATE = "use YYYY-MM-DD, day-first dd-mm-yyyy, or a written month -- 1988-03-14, 14-03-1988, 14 Mar 1988";

const MONTH_LABEL = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Reads one date in any accepted format; returns ISO YYYY-MM-DD, plus a `note` when a convention was
 * applied that the file's author might not share (the day-first reading of an ambiguous numeric date).
 */
export function readDate(raw: string): { iso: string; note?: string } | { error: string } {
  const s = raw.trim();
  let y = 0, m = 0, d = 0, hit;
  let note: string | undefined;
  if ((hit = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) {
    [y, m, d] = [+hit[1], +hit[2], +hit[3]];
  } else if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) {
    // DAY FIRST, by declared convention.
    [y, m, d] = [+hit[3], +hit[2], +hit[1]];
    if (m > 12)
      return { error: `"${s}" read day-first (dd-mm-yyyy, this import's stated convention) makes the month ${m}, which does not exist -- if this file is month-first, rewrite it as YYYY-MM-DD or a written month` };
    if (d <= 12 && d !== m)
      note = `"${s}" was read day-first as ${d} ${MONTH_LABEL[m]} ${y} -- if this file is month-first, that is the wrong date: rewrite as YYYY-MM-DD or a written month`;
  } else if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2}$/.test(s)) {
    return { error: `"${s}" has a two-digit year, and a century is not something to guess -- ${HOW_TO_DATE}` };
  } else if ((hit = /^(\d{1,2})[ -]([a-zA-Z]+),?[ -]+(\d{4})$/.exec(s))) {
    const mm = MONTH_NAMES.get(hit[2].toLowerCase());
    if (!mm) return { error: `"${s}": "${hit[2]}" is not a month name this import knows` };
    [y, m, d] = [+hit[3], mm, +hit[1]];
  } else if ((hit = /^([a-zA-Z]+)[ -](\d{1,2}),?[ -]+(\d{4})$/.exec(s))) {
    const mm = MONTH_NAMES.get(hit[1].toLowerCase());
    if (!mm) return { error: `"${s}": "${hit[1]}" is not a month name this import knows` };
    [y, m, d] = [+hit[3], mm, +hit[2]];
  } else {
    return { error: `"${s}" is not a date this import can read -- ${HOW_TO_DATE}` };
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d)
    return { error: `"${s}" is not a real calendar date` };
  const pad = (n: number) => String(n).padStart(2, "0");
  return { iso: `${y}-${pad(m)}-${pad(d)}`, note };
}

/** Reads one time: 24-hour HH:MM, or 12-hour with am/pm (2:30 pm, 9am). Returns HH:MM. */
export function readTime(raw: string): { hhmm: string } | { error: string } {
  const s = raw.trim().toLowerCase();
  const hit = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  const how = `"${raw.trim()}" is not a time this import can read -- use 24-hour HH:MM (14:30) or am/pm (2:30 pm)`;
  if (!hit) return { error: how };
  let h = +hit[1];
  const min = hit[2] === undefined ? 0 : +hit[2];
  const half = hit[3];
  // A bare number with no minutes AND no am/pm ("14") is refused: it is as likely a typo as a time.
  if (hit[2] === undefined && !half) return { error: how };
  if (min > 59) return { error: how };
  if (half) {
    if (h < 1 || h > 12) return { error: how };
    if (half === "am") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) {
    return { error: how };
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return { hhmm: `${pad(h)}:${pad(min)}` };
}

export function parseImportCsv(text: string): ParseResult {
  const fileProblems: string[] = [];
  const lines = text.split(/\r\n|\n|\r/).filter((l, i) => i === 0 || l.trim() !== "");
  if (lines.length === 0 || lines[0].trim() === "")
    return { rows: [], fileProblems: ["the file is empty"] };

  const header = splitCsvLine(lines[0], 1, fileProblems);
  if (!header) return { rows: [], fileProblems };
  const cols = header.map(canon);

  // ⚠ AN UNKNOWN HEADER IS NAMED, NOT IGNORED. A typo like "apointment_date" silently ignored would
  // import every patient without their appointments and read as success.
  const known = new Set<string>(IMPORT_COLUMNS);
  const unknown = cols.filter(c => c !== "" && !known.has(c));
  if (unknown.length > 0)
    fileProblems.push(`unknown column(s): ${unknown.join(", ")} -- expected any of: ${IMPORT_COLUMNS.join(", ")}`);

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_IMPORT_ROWS) {
    fileProblems.push(`the file has ${dataLines.length} rows and the cap is ${MAX_IMPORT_ROWS} -- split it and import in parts (nothing from this file was imported)`);
    return { rows: [], fileProblems };
  }

  const rows: ParsedRow[] = [];
  for (let li = 0; li < dataLines.length; li++) {
    const parts = splitCsvLine(dataLines[li], li + 2, fileProblems);
    if (!parts) continue;
    const get = (name: string) => {
      const idx = cols.indexOf(name);
      const v = idx >= 0 ? (parts[idx] ?? "").trim() : "";
      return v === "" ? undefined : v;
    };

    const problems: string[] = [];
    const appointmentProblems: string[] = [];
    const notes: string[] = [];
    const fields: ImportFields = {
      firstName: get("first_name"), middleName: get("middle_name"), lastName: get("last_name"),
      dateOfBirth: get("date_of_birth"), sex: get("sex"),
      phone: get("phone"), email: get("email"), nationalId: get("national_id"),
      guardianName: get("guardian_name"), guardianRelationship: get("guardian_relationship"),
      guardianPhone: get("guardian_phone"), guardianEmail: get("guardian_email"),
      reasonForVisit: get("reason_for_visit"),
      location: get("location"), appointmentDate: get("appointment_date"),
      appointmentTime: get("appointment_time"), appointmentType: get("appointment_type"),
      externalId: get("external_id"),
    };

    // Entirely blank data row: skip silently -- trailing blank lines are how spreadsheets export.
    if (Object.values(fields).every(v => v === undefined)) continue;

    // ── The person (mirrors the registration screen, which mirrors the engines) ──
    if (!fields.firstName && !fields.middleName && !fields.lastName)
      problems.push("a name is required -- any one of first_name, middle_name or last_name is enough");

    const rawAge = get("estimated_age");
    if (rawAge !== undefined) {
      const n = Number(rawAge);
      if (!Number.isInteger(n) || n < 0 || n > 130) problems.push(`estimated_age "${rawAge}" is not a whole number of years between 0 and 130`);
      else fields.estimatedAge = n;
    }
    if (fields.dateOfBirth) {
      const read = readDate(fields.dateOfBirth);
      if ("error" in read) problems.push(`date_of_birth ${read.error}`);
      else if (Date.parse(read.iso) > Date.now())
        problems.push(`date_of_birth "${fields.dateOfBirth}" is in the future`);
      else {
        // NORMALISED HERE, so everything downstream -- the age judgement, the engines, the duplicate
        // screen -- sees one canonical form whatever the file carried. An applied convention is
        // ANNOUNCED, at preview and in the ledger, never silent.
        if (read.note) notes.push(`date_of_birth ${read.note}`);
        fields.dateOfBirth = read.iso;
      }
    }
    if (!fields.dateOfBirth && fields.estimatedAge === undefined)
      problems.push("date_of_birth or estimated_age is required");

    if (fields.sex !== undefined) {
      const mapped = SEX_VALUES.get(fields.sex.toLowerCase());
      if (!mapped) problems.push(`sex "${fields.sex}" is not one of female, male, other, unknown (blank is allowed)`);
      else fields.sex = mapped;
    }

    const guardianContact = fields.guardianPhone || fields.guardianEmail;
    if (!fields.phone && !fields.email && !guardianContact)
      problems.push("a contact is required -- phone or email, or a guardian_phone or guardian_email");

    if (fields.guardianName) {
      const rel = canon(fields.guardianRelationship ?? "guardian");
      if (!RELATIONSHIP_CODES.has(rel))
        problems.push(`guardian_relationship "${fields.guardianRelationship}" is not one of: ${[...RELATIONSHIP_CODES].join(", ")}`);
      else fields.guardianRelationship = rel;
    } else if (fields.guardianRelationship || fields.guardianPhone || fields.guardianEmail) {
      problems.push("guardian columns are filled but guardian_name is empty -- the contact would belong to nobody");
    }

    // The guardian rule, PRE-STATED so the preview can say it before the engine refuses it. The engine
    // (relationshipExpectation) remains the authority at commit: certain minors need a guardian, and an
    // ESTIMATED age within 2 years of majority is treated as a minor because it cannot prove otherwise.
    const age = fields.dateOfBirth
      ? Math.floor((Date.now() - Date.parse(fields.dateOfBirth)) / (365.25 * 24 * 3600 * 1000))
      : fields.estimatedAge;
    const needsGuardian = age !== undefined &&
      (age < MAJORITY_AGE || (fields.dateOfBirth === undefined && age <= MAJORITY_AGE + 2));
    if (needsGuardian) {
      const authority = fields.guardianName && GUARDIAN_TYPES.has(fields.guardianRelationship ?? "guardian");
      if (!authority)
        problems.push(`a patient aged ${age} needs a guardian_name whose guardian_relationship can hold authority (${[...GUARDIAN_TYPES].join(", ")})`);
    }

    // ── The appointment (decision 2: problems here drop the appointment, never the person) ──
    fields.appointmentType = fields.appointmentType ? canon(fields.appointmentType) : undefined;
    const wantsAppointment = !!(fields.appointmentDate || fields.appointmentTime);
    if (wantsAppointment) {
      if (!fields.appointmentDate) {
        appointmentProblems.push("appointment_time is filled but appointment_date is empty");
      } else {
        const read = readDate(fields.appointmentDate);
        if ("error" in read) appointmentProblems.push(`appointment_date ${read.error}`);
        else {
          if (read.note) notes.push(`appointment_date ${read.note}`);
          fields.appointmentDate = read.iso;
        }
      }
      if (!fields.appointmentTime) {
        appointmentProblems.push("appointment_date is filled but appointment_time is empty -- the practice clock needs a time of day");
      } else {
        const read = readTime(fields.appointmentTime);
        if ("error" in read) appointmentProblems.push(`appointment_time ${read.error} (times are read in the practice timezone)`);
        else fields.appointmentTime = read.hhmm;
      }
      if (fields.appointmentType && !APPOINTMENT_TYPES.has(fields.appointmentType))
        appointmentProblems.push(`appointment_type "${fields.appointmentType}" is not one of: ${[...APPOINTMENT_TYPES].join(", ")}`);
    } else if (fields.location) {
      appointmentProblems.push("location is filled but there is no appointment_date -- a location alone books nothing");
    }

    rows.push({ rowNumber: li + 1, fields, problems, appointmentProblems, notes, wantsAppointment });
  }

  return { rows, fileProblems };
}

// ── Practice-timezone instant ───────────────────────────────────────────────────────────────────────
// The CSV carries a wall-clock time in the practice timezone (the only honest reading of a column a
// receptionist typed). instantInZone MOVED to practice-time.ts -- the one-clock module -- when the
// appointments API needed the same conversion (the patient-page booking widget had been stamping a
// literal Z onto wall-clock time). Re-exported so this engine's callers and harness keep one import.
export { instantInZone };

// ── Shared row context ─────────────────────────────────────────────────────────────────────────────

type RowContext = {
  timezone: string;
  locations: Map<string, { id: string; name: string }>;
  /** external ids that have ALREADY produced a patient in this workspace. */
  claimed: Set<string>;
};

async function loadRowContext(admin: any, ctx: WorkspaceContext, rows: ParsedRow[]): Promise<EngineResult<RowContext>> {
  const { data: ws, error: wsErr } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  if (wsErr) return { ok: false, status: 502, code: "WORKSPACE_READ_FAILED", message: wsErr.message };
  const timezone = (ws?.timezone as string | null) || "UTC";

  const { data: locs, error: locErr } = await admin.from("practice_location")
    .select("id, name").eq("workspace_id", ctx.workspaceId).eq("active", true);
  if (locErr) return { ok: false, status: 502, code: "LOCATION_READ_FAILED", message: locErr.message };
  const locations = new Map(((locs ?? []) as any[]).map(l => [String(l.name).trim().toLowerCase(), { id: l.id, name: l.name }]));

  const externalIds = rows.map(r => r.fields.externalId).filter((v): v is string => !!v);
  const claimed = new Set<string>();
  if (externalIds.length > 0) {
    const { data: prior, error: priorErr } = await admin.from("practice_import_row")
      .select("claimed_external_id").eq("workspace_id", ctx.workspaceId).in("claimed_external_id", externalIds);
    if (priorErr) return { ok: false, status: 502, code: "LEDGER_READ_FAILED", message: priorErr.message };
    for (const p of (prior ?? []) as any[]) if (p.claimed_external_id) claimed.add(p.claimed_external_id);
  }
  return { ok: true, data: { timezone, locations, claimed } };
}

function toRegistrationInput(fields: ImportFields, correlationId: string) {
  const guardian = fields.guardianName ? [{
    relationshipType: fields.guardianRelationship ?? "guardian",
    fullName: fields.guardianName,
    phone: fields.guardianPhone, email: fields.guardianEmail,
    isLegalGuardian: GUARDIAN_TYPES.has(fields.guardianRelationship ?? "guardian"),
    mayReceiveInformation: GUARDIAN_TYPES.has(fields.guardianRelationship ?? "guardian"),
    isPrimary: true,
  }] : undefined;
  return {
    givenName: fields.firstName, middleName: fields.middleName, familyName: fields.lastName,
    sex: fields.sex, birthDate: fields.dateOfBirth, ageEstimateYears: fields.estimatedAge,
    phone: fields.phone, email: fields.email, nationalId: fields.nationalId,
    relationships: guardian,
    reasonForVisit: fields.reasonForVisit,
    correlationId,
  };
}

// ── Preview ────────────────────────────────────────────────────────────────────────────────────────

export type PreviewVerdict = "register" | "register_and_book" | "skip_duplicate" | "skip_already_imported" | "error";
export type PreviewRow = {
  rowNumber: number;
  name: string;
  verdict: PreviewVerdict;
  problems: string[];
  notes: string[];
  candidates?: { id: string; displayName: string }[];
};
export type ImportPreview = {
  fileProblems: string[];
  rows: PreviewRow[];
  counts: Record<PreviewVerdict, number>;
  rowCount: number;
};

/** Dry run: every judgement, no writes. screenRegistration IS the registration judgement. */
export async function previewPatientImport(
  admin: any, ctx: WorkspaceContext, csvText: string,
): Promise<EngineResult<ImportPreview>> {
  if (!ctx.capabilities.includes("patient.create"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.create is required" };
  if (csvText.length > MAX_IMPORT_BYTES)
    return { ok: false, status: 413, code: "FILE_TOO_LARGE", message: `the file is over ${MAX_IMPORT_BYTES} bytes` };

  const parsed = parseImportCsv(csvText);
  const loaded = await loadRowContext(admin, ctx, parsed.rows);
  if (!loaded.ok) return loaded;
  const rc = loaded.data;

  // Intra-file collisions: the same external id or national id twice in one file is a file bug worth
  // naming BEFORE commit order decides which row wins. (A shared phone is NOT flagged: households are
  // real, and the name+birth-date screen catches a genuinely repeated person.)
  const seenExternal = new Map<string, number>(); const seenNational = new Map<string, number>();
  for (const row of parsed.rows) {
    const x = row.fields.externalId;
    if (x) { if (seenExternal.has(x)) row.problems.push(`external_id "${x}" also appears on row ${seenExternal.get(x)} of this file`); else seenExternal.set(x, row.rowNumber); }
    const n = row.fields.nationalId?.toLowerCase().replace(/\s+/g, "");
    if (n) { if (seenNational.has(n)) row.problems.push(`national_id also appears on row ${seenNational.get(n)} of this file`); else seenNational.set(n, row.rowNumber); }
  }

  const out: PreviewRow[] = [];
  for (const row of parsed.rows) {
    const f = row.fields;
    const name = [f.firstName, f.middleName, f.lastName].filter(Boolean).join(" ") || "(no name)";
    const notes: string[] = [...row.notes, ...row.appointmentProblems.map(p => `appointment will be dropped: ${p}`)];

    if (row.fields.externalId && rc.claimed.has(row.fields.externalId)) {
      out.push({ rowNumber: row.rowNumber, name, verdict: "skip_already_imported", problems: row.problems, notes: [`external_id "${row.fields.externalId}" already created a patient in an earlier import`] });
      continue;
    }
    if (row.problems.length > 0) {
      out.push({ rowNumber: row.rowNumber, name, verdict: "error", problems: row.problems, notes });
      continue;
    }

    const screened = await screenRegistration(admin, {
      workspaceId: ctx.workspaceId,
      givenName: f.firstName, middleName: f.middleName, familyName: f.lastName,
      birthDate: f.dateOfBirth, ageEstimateYears: f.estimatedAge,
      phone: f.phone ?? f.guardianPhone, email: f.email ?? f.guardianEmail,
      identifiers: f.nationalId ? [{ type: "national_id", value: f.nationalId }] : undefined,
    });
    if (!screened.ok && (screened.code === "DUPLICATE_IDENTIFIER" || screened.code === "POSSIBLE_DUPLICATE")) {
      out.push({
        rowNumber: row.rowNumber, name, verdict: "skip_duplicate", problems: [], notes,
        candidates: (screened.candidates ?? []).map((c: Candidate) => ({ id: (c as any).id, displayName: (c as any).displayName })),
      });
      continue;
    }
    if (!screened.ok) {
      // Includes DUPLICATE_CHECK_FAILED: a check that could not run is not a check that passed.
      out.push({ rowNumber: row.rowNumber, name, verdict: "error", problems: [screened.message], notes });
      continue;
    }

    let verdict: PreviewVerdict = "register";
    if (row.wantsAppointment && row.appointmentProblems.length === 0) {
      const locKey = f.location?.trim().toLowerCase();
      if (locKey && !rc.locations.has(locKey)) {
        notes.push(`appointment will be dropped: location "${f.location}" is not an active location of this practice (${[...rc.locations.values()].map(l => l.name).join(", ") || "none are configured"})`);
      } else if (!instantInZone(f.appointmentDate!, f.appointmentTime!, rc.timezone)) {
        notes.push(`appointment will be dropped: ${f.appointmentDate} ${f.appointmentTime} could not be read as a time in ${rc.timezone}`);
      } else {
        verdict = "register_and_book";
        notes.push(`appointment will be attempted at ${f.appointmentDate} ${f.appointmentTime} (${rc.timezone}); if the diary refuses it, the patient still registers and the report says why`);
      }
    }
    if (f.reasonForVisit && verdict === "register")
      notes.push("reason_for_visit is only stored on an appointment; with no appointment it will not be kept");
    out.push({ rowNumber: row.rowNumber, name, verdict, problems: [], notes });
  }

  const counts = { register: 0, register_and_book: 0, skip_duplicate: 0, skip_already_imported: 0, error: 0 } as Record<PreviewVerdict, number>;
  for (const r of out) counts[r.verdict]++;
  return { ok: true, data: { fileProblems: parsed.fileProblems, rows: out, counts, rowCount: out.length } };
}

// ── Commit ─────────────────────────────────────────────────────────────────────────────────────────

export type CommitOutcome = "REGISTERED" | "REGISTERED_AND_BOOKED" | "SKIPPED_DUPLICATE" | "SKIPPED_ALREADY_IMPORTED" | "ERROR";
export type CommitRow = {
  rowNumber: number; name: string; outcome: CommitOutcome;
  patientId: string | null; appointmentId: string | null; detail: string;
};
export type CommitReport = {
  runId: string;
  rows: CommitRow[];
  registered: number; booked: number; skipped: number; errors: number;
};

export async function commitPatientImport(
  admin: any, ctx: WorkspaceContext, args: { csvText: string; fileName?: string },
): Promise<EngineResult<CommitReport>> {
  if (!ctx.capabilities.includes("patient.create"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.create is required" };
  if (args.csvText.length > MAX_IMPORT_BYTES)
    return { ok: false, status: 413, code: "FILE_TOO_LARGE", message: `the file is over ${MAX_IMPORT_BYTES} bytes` };

  const parsed = parseImportCsv(args.csvText);
  // ⚠ A FILE-LEVEL PROBLEM STOPS THE WHOLE COMMIT. Committing "the readable part" of a file with an
  // unclosed quote or an unknown column imports a register nobody checked. Preview shows the same
  // problems, so nothing here is a surprise.
  if (parsed.fileProblems.length > 0)
    return { ok: false, status: 422, code: "FILE_PROBLEMS", message: parsed.fileProblems.join("; ") };
  if (parsed.rows.length === 0)
    return { ok: false, status: 422, code: "EMPTY_FILE", message: "the file has no data rows" };

  const sha = createHash("sha256").update(args.csvText).digest("hex");
  const { data: prior, error: priorErr } = await admin.from("practice_import_run")
    .select("id, created_at").eq("workspace_id", ctx.workspaceId).eq("file_sha256", sha).eq("status", "COMPLETED").limit(1);
  if (priorErr) return { ok: false, status: 502, code: "LEDGER_READ_FAILED", message: priorErr.message };
  if ((prior ?? []).length > 0)
    return {
      ok: false, status: 409, code: "ALREADY_IMPORTED",
      message: `this exact file already completed as run ${(prior as any[])[0].id} on ${(prior as any[])[0].created_at} -- change the file (or remove the rows that were imported) and try again`,
    };

  const loaded = await loadRowContext(admin, ctx, parsed.rows);
  if (!loaded.ok) return loaded;
  const rc = loaded.data;

  const { data: run, error: runErr } = await admin.from("practice_import_run").insert({
    workspace_id: ctx.workspaceId, created_by: ctx.userId,
    file_name: args.fileName ?? null, file_sha256: sha, row_count: parsed.rows.length,
  }).select("id").single();
  if (runErr || !run) return { ok: false, status: 502, code: "RUN_CREATE_FAILED", message: runErr?.message ?? "no row" };
  const runId = run.id as string;

  const rows: CommitRow[] = [];
  for (const row of parsed.rows) {
    const f = row.fields;
    const name = [f.firstName, f.middleName, f.lastName].filter(Boolean).join(" ") || "(no name)";
    // The day-first announcements travel into the ledger detail: the reconciliation record must show
    // HOW an ambiguous date was read, not merely what it became.
    const details: string[] = [...row.notes];
    let outcome: CommitOutcome; let patientId: string | null = null; let appointmentId: string | null = null;

    if (f.externalId && rc.claimed.has(f.externalId)) {
      outcome = "SKIPPED_ALREADY_IMPORTED";
      details.push(`external_id "${f.externalId}" already created a patient in an earlier import`);
    } else if (row.problems.length > 0) {
      outcome = "ERROR";
      details.push(...row.problems);
    } else {
      const made = await register(admin, ctx, toRegistrationInput(f, runId));
      if (!made.ok && (made.code === "DUPLICATE_IDENTIFIER" || made.code === "POSSIBLE_DUPLICATE")) {
        outcome = "SKIPPED_DUPLICATE";
        const cands = ((made as any).candidates ?? []) as any[];
        details.push(`matches ${cands.map(c => c.displayName).join(", ") || "an existing patient"} -- decision 1: the register is never doubled by a file, review by hand`);
      } else if (!made.ok) {
        outcome = "ERROR";
        details.push(made.message);
      } else {
        patientId = made.data.patientId;
        outcome = "REGISTERED";
        for (const inc of made.data.incomplete) details.push(`${inc.step}: ${inc.reason}`);
        // external_id claims the unique index the moment the patient exists (migration 288 layer 1).
        if (f.externalId) rc.claimed.add(f.externalId);

        if (row.wantsAppointment) {
          if (row.appointmentProblems.length > 0) {
            details.push(...row.appointmentProblems.map(p => `appointment dropped: ${p}`));
          } else {
            const locKey = f.location?.trim().toLowerCase();
            const loc = locKey ? rc.locations.get(locKey) : undefined;
            const instant = instantInZone(f.appointmentDate!, f.appointmentTime!, rc.timezone);
            if (locKey && !loc) {
              details.push(`appointment dropped: location "${f.location}" is not an active location of this practice`);
            } else if (!instant) {
              details.push(`appointment dropped: ${f.appointmentDate} ${f.appointmentTime} could not be read as a time in ${rc.timezone}`);
            } else {
              const booked = await bookAppointment(admin, {
                workspaceId: ctx.workspaceId, patientId, patientName: made.data.displayName,
                patientPhone: f.phone,
                scheduledAt: instant, appointmentType: f.appointmentType ?? "new_consultation",
                locationId: loc?.id ?? null, reason: f.reasonForVisit,
                actorId: ctx.userId, correlationId: runId,
              } as any);
              if (booked.ok) { appointmentId = booked.data.id; outcome = "REGISTERED_AND_BOOKED"; }
              else details.push(`appointment dropped: ${booked.message} -- decision 2: the patient is registered, rebook by hand`);
            }
          }
        } else if (f.reasonForVisit) {
          details.push("reason_for_visit not kept: it is only stored on an appointment and none was made");
        }
      }
    }

    const { error: rowErr } = await admin.from("practice_import_row").insert({
      run_id: runId, workspace_id: ctx.workspaceId, row_number: row.rowNumber,
      external_id: f.externalId ?? null,
      claimed_external_id: patientId && f.externalId ? f.externalId : null,
      outcome, patient_id: patientId, appointment_id: appointmentId,
      detail: details.join("; ") || null,
    });
    // A ledger row that could not be written is REPORTED ON THE ROW: the patient exists either way,
    // and pretending otherwise would hide a created record from the reconciliation report.
    if (rowErr) details.push(`ledger write failed: ${rowErr.message}`);

    rows.push({ rowNumber: row.rowNumber, name, outcome, patientId, appointmentId, detail: details.join("; ") });
  }

  const registered = rows.filter(r => r.outcome === "REGISTERED" || r.outcome === "REGISTERED_AND_BOOKED").length;
  const booked = rows.filter(r => r.outcome === "REGISTERED_AND_BOOKED").length;
  const skipped = rows.filter(r => r.outcome === "SKIPPED_DUPLICATE" || r.outcome === "SKIPPED_ALREADY_IMPORTED").length;
  const errors = rows.filter(r => r.outcome === "ERROR").length;

  await admin.from("practice_import_run").update({
    status: "COMPLETED", completed_at: new Date().toISOString(),
    registered_count: registered, booked_count: booked, skipped_count: skipped, error_count: errors,
  }).eq("id", runId);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.patients_imported",
    payload: { runId, rowCount: rows.length, registered, booked, skipped, errors },
    correlationId: runId,
  });

  return { ok: true, data: { runId, rows, registered, booked, skipped, errors } };
}

// ── Report reads ───────────────────────────────────────────────────────────────────────────────────

export async function listImportRuns(admin: any, ctx: WorkspaceContext): Promise<EngineResult<any[]>> {
  const { data, error } = await admin.from("practice_import_run")
    .select("id, file_name, row_count, registered_count, booked_count, skipped_count, error_count, status, created_at, completed_at")
    .eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }).limit(20);
  if (error) return { ok: false, status: 502, code: "LEDGER_READ_FAILED", message: error.message };
  return { ok: true, data: (data ?? []) as any[] };
}

export async function importRunRows(admin: any, ctx: WorkspaceContext, runId: string): Promise<EngineResult<any[]>> {
  const { data, error } = await admin.from("practice_import_row")
    .select("row_number, external_id, outcome, patient_id, appointment_id, detail, created_at")
    .eq("workspace_id", ctx.workspaceId).eq("run_id", runId).order("row_number");
  if (error) return { ok: false, status: 502, code: "LEDGER_READ_FAILED", message: error.message };
  return { ok: true, data: (data ?? []) as any[] };
}
