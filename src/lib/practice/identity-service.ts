import QRCode from "qrcode";
import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import {
  getFormat, formatPractitionerNumber, parsePractitionerNumber, lockFormat,
} from "@/lib/practice/identifier-format";

// PIS-000 v1.0 (Frozen) -- PRACTITIONER IDENTITY SERVICE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// AN IDENTITY IS NOT SCOPED TO A PRACTICE. s1 "independent of employers", s15 "remains valid when
// changing workplaces". Every function here is keyed on the USER, and the workspace a booking lands in
// is a nullable pointer that can be moved or cleared without touching the number, the handle or the URL.
//
// PRIVACY BY DEFAULT (s1). Discovery starts 'hidden'; s7's public mode is something a practitioner
// chooses, once, knowingly. This publishes a real person's name, qualifications and place of work.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// WHAT IS NOT BUILT, AND WHY -- see NOT_BUILT below rather than a comment nobody reads.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

/** s7. Public is the only mode that reaches search; the rest differ in how a link behaves. */
export const DISCOVERY_MODES = [
  { key: "hidden", label: "Hidden", detail: "Nobody can reach your page, by search or by link. This is where every identity starts." },
  { key: "link_only", label: "Anyone with the link", detail: "Your page works for anybody who has the URL or scans your code, and never appears in search." },
  { key: "existing_patients", label: "Existing patients only", detail: "The page resolves, and says so, but booking is for people already registered with your practice." },
  { key: "referral_only", label: "By referral", detail: "The page resolves and states that new bookings come by referral." },
  { key: "public", label: "Listed publicly", detail: "Your name, qualifications and locations appear in public search results. This publishes you." },
] as const;

/** s10. Ordered, because the lifecycle is a progression and the UI derives its next step from this. */
export const IDENTITY_STATES = [
  "created", "email_verified", "licence_verified", "active",
  "temporarily_hidden", "suspended", "archived", "deleted",
] as const;

/**
 * Which states may reach the public, whatever the discovery mode says.
 *
 * ⚠ EXPORTED FOR WORDING, NEVER FOR DECIDING. resolveHandle() below is the only thing that says whether
 * an address opens; a second place that re-checks `discovery !== hidden && RESOLVABLE_STATES.has(status)`
 * is a copy that drifts the moment this set changes, and the screen it feeds would go on offering a QR
 * code and a print button for an address the resolver refuses. Callers outside this module use it to
 * EXPLAIN a refusal the resolver has already made -- see identitySetupView's `address.remaining`.
 */
export const RESOLVABLE_STATES = new Set(["active", "licence_verified"]);

/**
 * ⚠ THE STATES A PRACTITIONER MAY NOT WALK OUT OF THEMSELVES.
 *
 * s10's table lets `suspended` go back to `active`, which is correct for the lifecycle and wrong for a
 * self-service button: a suspension is something an operator did, and a practitioner who could clear it
 * from their own settings page has not been suspended at all. `archived` and `deleted` are terminal by
 * intent. So publication refuses them and says who to ask, rather than quietly reversing somebody's
 * decision. Nothing here changes TRANSITIONS -- an operator surface can still make those moves.
 */
export const NOT_SELF_PUBLISHABLE = new Set(["suspended", "archived", "deleted"]);

export const NOT_BUILT = [
  {
    key: "otp_booking",
    spec: "PIS-000 s11",
    label: "OTP verification before booking confirmation",
    // ⚠ REWRITTEN BECAUSE IT HAD STOPPED BEING TRUE, not because it was inconvenient. It used to read
    // "there is no channel column and no sent_at anywhere", which was correct until migration 224 built
    // the challenge store and 254 built the patient session. Both exist, and so does the whole request /
    // verify / intake / confirmation path in patient-booking.ts. What is missing is a PROVIDER, which is
    // configuration rather than code -- so this entry now describes a deployment, and says which.
    // ⚠ REWRITTEN 2026-08-29 (CPR-BOOK-EMAIL-001): the old sentence said this deployment had no mail
    // provider, which stopped being true. What decides today is the PRACTICE's own switch.
    detail: "Sending a one-time code needs a sending channel the practice has switched on in Patient Communications. A practice with email on sends codes for real; one without has no channel, and the code is refused outright rather than printed to the screen or pretended sent. The machinery is built and exercised end to end: the challenge store, the short-lived patient session, and the request/verify/intake/confirmation path.",
  },
  {
    key: "licence_verification",
    spec: "PIS-000 s10, s14",
    label: "Automated licence verification",
    detail: "s14 lists integration with professional councils as future work. The licence_verified state exists and is recorded with who checked and when, which is a provenance record rather than a verification. Nothing here contacts a council.",
  },
  {
    key: "qr_pdf",
    spec: "PIS-000 s12",
    label: "QR codes as PDF",
    detail: "SVG and PNG are generated here, in process, with no external service. PDF would need a second library; the printable card page prints to PDF from the browser instead.",
  },
  {
    key: "short_url",
    spec: "PIS-000 s12",
    label: "A separate short URL",
    detail: "A short URL needs a domain and a redirect service that this deployment does not have. The canonical URL is already short -- a handle plus a host -- so a second one would be an alias to maintain rather than a feature.",
  },
  {
    key: "telemedicine",
    spec: "PIS-000 s5",
    label: "Telemedicine",
    detail: "Named in s5 as a future capability. Nothing is built and nothing pretends to be.",
  },
] as const;

// ── URLS ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The canonical host.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THE ADDRESS WAS DECIDED, AND THREE DIFFERENT ONES WERE IN PLAY UNTIL IT WAS.
 *
 *   PIS-000 s8 and this code    https://practice.competenhealthcare.com/@handle
 *   CPB-001's comp              https://booking.competenpractice.com/@dreokaisu
 *   CPB-002's spec and comp     https://competenhealthcare.com/practice/book/@dreokaisu
 *
 * The third is the one chosen: one domain, no `practice.` subdomain, the path carrying the meaning. It
 * is recorded here rather than in the three places that used to compose it, because THIS STRING GOES ON
 * A PRINTED CARD AND AN A4 POSTER. A screen showing a stale link is fixed by a deploy; a thousand printed
 * cards are not, and a patient holding one has no way to reach their practitioner.
 *
 * NOT HARDCODED, STILL: read from the environment with the decision as the default, so a deployment that
 * serves a different host does not need a hunt through string literals.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export function identityHost(): string {
  return (process.env.NEXT_PUBLIC_PRACTICE_IDENTITY_HOST ?? "https://competenhealthcare.com")
    .replace(/\/+$/, "");
}

/**
 * ⚠ THE PATH, AS ONE CONSTANT, AND THE ROUTE THAT SERVES IT MUST MATCH IT.
 *
 * src/app/practice/book/[handle]/page.tsx is the route. Changing one without the other prints a link
 * this application does not serve, and the harness asserts the pair rather than trusting this comment.
 */
export const BOOKING_PATH = "/practice/book/";

/**
 * ⚠ THE ONE CONSTRUCTION OF A BOOKING LINK. Everything that shows, shares, encodes or prints one goes
 * through here -- the QR generator below, the share templates below, the setup console's live preview
 * and the public page itself. A second composition anywhere is a card printed pointing at an address the
 * application does not serve, and unlike a screen you cannot redeploy a poster.
 */
export const bookingUrl = (handle: string) => `${identityHost()}${BOOKING_PATH}@${handle}`;

/** The same link as a path, for an in-application redirect that must not leave the host. */
export const bookingPath = (handle: string) => `${BOOKING_PATH}@${handle}`;

// ── HANDLES ──────────────────────────────────────────────────────────────────────────────────────────

const HANDLE_RE = /^[a-z][a-z0-9]{2,29}$/;

/** s3: lowercase letters and digits only, no spaces or punctuation. */
export function normaliseHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * s3's algorithm, exactly: first initial + surname, then first name + surname, then numeric suffixes.
 *
 * RETURNS THE WHOLE LADDER, not the first free rung. The caller checks availability in order, which
 * keeps the generation rule (this function, pure and testable) apart from the uniqueness rule (the
 * database, which is the only thing that can settle a race).
 */
export function handleCandidates(displayName: string, limit = 12): string[] {
  // Titles are not names. "Dr Elisha Okaisu" must not yield @dokaisu.
  const words = displayName.trim().split(/\s+/)
    .map(w => w.replace(/[^A-Za-z'-]/g, ""))
    .filter(w => w.length > 0 && !/^(dr|prof|professor|mr|mrs|ms|miss|sr|sister|nurse|mx)\.?$/i.test(w));
  if (words.length === 0) return [];

  const first = words[0].toLowerCase().replace(/[^a-z]/g, "");
  const surname = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  if (!surname) return [];

  const out: string[] = [];
  const push = (h: string) => {
    if (HANDLE_RE.test(h) && !out.includes(h)) out.push(h);
  };

  // s3 order: first initial + surname, then first name + surname.
  if (first) push(first[0] + surname);
  if (first && first !== surname) push(first + surname);
  push(surname);

  // Then numeric suffixes on the preferred stem until unique.
  const stem = (first ? first[0] + surname : surname).slice(0, 26);
  for (let n = 1; out.length < limit; n++) {
    push(`${stem}${n}`);
    if (n > 200) break;
  }
  return out.slice(0, limit);
}

/**
 * Is this handle available?
 *
 * THREE WAYS TO BE UNAVAILABLE, and they are deliberately not distinguished to the caller beyond a
 * reason code: taken by a live identity, reserved (s4), or RETIRED BY SOMEBODY ELSE. The third is the
 * one that is easy to miss -- a released handle stays claimed, because posters and QR codes printed
 * with it are still in circulation and reassigning it would send a stranger's patients to somebody new.
 *
 * ⚠ A FAILED READ IS `unreadable`, NOT `available`. The first version of this function destructured only
 * `data` from all three queries, so a database that could not answer produced a confident "yes, that one
 * is free" -- and the caller would then write it. Reserved and retired have no database constraint
 * behind them (nothing links practice_reserved_handle or practice_handle_history to the identity's
 * handle column), so THIS read is the only thing enforcing them and it must never fail open.
 *
 * ⚠ THIS IS NOT THE COLLISION CONTROL. Two people claiming the same free handle in the same instant
 * both read "available" here. What settles that is the unique constraint on the column, and the writers
 * below attempt the write and handle the violation rather than trusting this answer.
 */
export async function handleAvailable(admin: any, handle: string, forIdentityId?: string): Promise<{
  available: boolean; reason?: "invalid" | "reserved" | "taken" | "retired" | "unreadable";
  because?: string;
}> {
  const h = normaliseHandle(handle);
  if (!HANDLE_RE.test(h)) return { available: false, reason: "invalid" };

  const { data: reserved, error: reservedError } = await admin.from("practice_reserved_handle")
    .select("handle").eq("handle", h).maybeSingle();
  if (reservedError) return { available: false, reason: "unreadable", because: reservedError.message };
  if (reserved) return { available: false, reason: "reserved" };

  const { data: taken, error: takenError } = await admin.from("practice_practitioner_identity")
    .select("id").eq("handle", h).maybeSingle();
  if (takenError) return { available: false, reason: "unreadable", because: takenError.message };
  if (taken && taken.id !== forIdentityId) return { available: false, reason: "taken" };

  const { data: retired, error: retiredError } = await admin.from("practice_handle_history")
    .select("identity_id").eq("handle", h).maybeSingle();
  if (retiredError) return { available: false, reason: "unreadable", because: retiredError.message };
  if (retired && retired.identity_id !== forIdentityId) return { available: false, reason: "retired" };

  return { available: true };
}

/**
 * ⚠ THE ONE BIT A "IS THIS FREE?" QUESTION MAY ANSWER.
 *
 * An availability endpoint is an enumeration oracle -- anybody who can call it can sweep the namespace
 * and learn which handles exist. That is tolerable here (three to thirty lowercase alphanumerics is a
 * small space, and the URLs are public by design; migration 254 says the same in as many words), but
 * only if the answer carries NOTHING BEYOND TAKEN-OR-FREE. `taken`, `reserved` and `retired` are
 * collapsed into one `unavailable` on purpose: which of the three it is would tell a sweeper whether a
 * real practitioner holds a name, which is a fact about a person rather than about a string.
 *
 * `invalid` is disclosed because it is a property of the characters typed, computable without asking
 * anybody. `unreadable` is disclosed because the alternative is reporting a database failure as "free".
 */
export type HandleCheck = {
  handle: string;
  /** The address the caller would get. Null when the handle could never be one. */
  url: string | null;
  state: "invalid" | "available" | "unavailable" | "unreadable";
};

export async function checkHandle(admin: any, raw: string, forIdentityId?: string): Promise<HandleCheck> {
  const h = normaliseHandle(raw);
  const result = await handleAvailable(admin, h, forIdentityId);
  const state: HandleCheck["state"] =
    result.available ? "available"
      : result.reason === "invalid" ? "invalid"
        : result.reason === "unreadable" ? "unreadable"
          : "unavailable";
  return { handle: h, url: state === "invalid" ? null : bookingUrl(h), state };
}

/** The first candidate that is actually free. */
export async function suggestHandle(admin: any, displayName: string): Promise<string | null> {
  for (const candidate of handleCandidates(displayName, 24)) {
    const { available } = await handleAvailable(admin, candidate);
    if (available) return candidate;
  }
  return null;
}

// ── THE IDENTITY ─────────────────────────────────────────────────────────────────────────────────────

export async function getIdentity(admin: any, userId: string) {
  const { data } = await admin.from("practice_practitioner_identity")
    .select("*").eq("user_id", userId).maybeSingle();
  return data ?? null;
}

/**
 * ⚠ WHAT A PRACTITIONER SHOULD KNOW BEFORE THEY CHOOSE ONE. Exported so the screen and the harness read
 * the same sentence -- a warning that lives only in JSX is a warning that can be dropped in a redesign
 * with nothing failing.
 */
export const HANDLE_PERMANENCE_NOTICE =
  "Choose carefully. If you change your handle later the old one is not released: it stays attached to "
  + "you for ever so that cards, posters and QR codes already carrying it keep reaching you rather than "
  + "a stranger. That also means nobody else can ever have it, including you under a different name.";

/**
 * Issue an identity. Idempotent per person.
 *
 * s15: "Every practitioner receives a permanent Practitioner Number, public handle, booking URL and QR
 * code automatically." Automatic, but NOT public: the number is issued, and discovery stays hidden until
 * the practitioner opts in.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ NO HANDLE IS ASSIGNED HERE, AND THAT IS A DEPARTURE FROM s15 TAKEN DELIBERATELY.
 *
 * This function used to call suggestHandle() and write the first free candidate onto the row. It is the
 * obvious reading of "automatically", and it is wrong for two reasons that only show up later:
 *
 *   1. A HANDLE IS A PUBLIC NAME. It is the address in https://practice.competenhealthcare.com/@handle,
 *      printed on cards and given to patients. Deriving it from a real person's name at signup publishes
 *      that name as a side effect of registering -- and nobody was asked.
 *   2. A HANDLE IS CLOSE TO PERMANENT. changeHandle() retires the old one into practice_handle_history,
 *      where it stays claimed for ever so printed codes keep working. So an auto-assigned @eokaisu that
 *      its owner then replaces has burned a name they never chose out of a shared namespace, for good.
 *
 * So provisioning creates the ROW -- the permanent number, the lifecycle, the private profile -- and the
 * practitioner CLAIMS the address themselves in Practice Setup, having seen the URL first. The schema
 * already permits exactly this: migration 218 declares `handle text unique check (handle is null or ...)`
 * and migration 254's booking-page foreign key is on a NULLABLE column, so an identity with no handle is
 * a legal, first-class state rather than a half-written row.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export async function issueIdentity(admin: any, args: {
  userId: string; displayName: string; workspaceId?: string | null; correlationId: string;
}): Promise<EngineResult<{ id: string; practitionerNumber: string; handle: string | null; created: boolean }>> {
  const existing = await getIdentity(admin, args.userId);
  if (existing) {
    return {
      ok: true,
      data: {
        id: existing.id, practitionerNumber: existing.practitioner_number,
        handle: existing.handle, created: false,
      },
    };
  }
  if (args.displayName.trim().length < 2)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a display name is required" };

  // A SEQUENCE, AND NOTHING ELSE. s2 says permanent and never reused, and max()+1 is wrong about the
  // second half: delete CPR-000005 and the next practitioner issued is handed 000005 again, so a number
  // that meant one clinician on a printed card now means another.
  //
  // A MISSING ALLOCATOR FAILS LOUDLY. Falling back to a count here would silently downgrade a guarantee
  // the whole identity rests on, and nothing downstream could tell the difference until two people
  // shared a number.
  // THE SHAPE COMES FROM THE FORMAT TABLE, NEVER FROM A LITERAL HERE. One place knows it, so agreeing a
  // new format reaches every future issuance, every validator and every parser at once.
  const format = await getFormat(admin);

  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: allocated, error: allocError } = await admin.rpc("practice_next_practitioner_sequence");
    if (allocError || allocated == null)
      return {
        ok: false, status: 503, code: "ALLOCATOR_UNAVAILABLE",
        message: "A practitioner number could not be allocated just now. Nothing was saved. Try again shortly.",
      };

    let practitionerNumber: string;
    try {
      practitionerNumber = formatPractitionerNumber(allocated as number, format);
    } catch (e) {
      // The sequence has outgrown the format. Refused here, loudly, rather than by writing a number that
      // does not match the shape everything else validates against.
      return {
        ok: false, status: 409, code: "FORMAT_TOO_NARROW",
        message: e instanceof Error ? e.message : String(e),
      };
    }

    const { data, error } = await admin.from("practice_practitioner_identity").insert({
      user_id: args.userId, practitioner_number: practitionerNumber,
      // ⚠ NULL, AND NOT BY OMISSION. Written out so that a future reader sees a decision rather than a
      // column somebody forgot. See the header.
      handle: null, display_name: args.displayName.trim(),
      primary_workspace_id: args.workspaceId ?? null,
      status: "created", discovery: "hidden",
      // WHICH SHAPE THIS ONE FOLLOWS, recorded rather than inferred from its appearance later.
      number_format_version: format.version,
    }).select("id, practitioner_number, handle").single();

    if (!error) {
      // A NUMBER HAS NOW BEEN ISSUED, so the format is locked: changing it from here on needs an
      // acknowledgement that existing numbers will not change.
      await lockFormat(admin);
      await audit(admin, {
        workspaceId: args.workspaceId ?? null, actorId: args.userId, eventType: "practice.identity_issued",
        payload: { identityId: data.id, practitionerNumber: data.practitioner_number, handle: data.handle },
        correlationId: args.correlationId,
      });
      return {
        ok: true,
        data: { id: data.id, practitionerNumber: data.practitioner_number, handle: data.handle, created: true },
      };
    }
    // A collision on the NUMBER is a race the sequence should have prevented, so take the next one. A
    // collision on user_id means somebody else issued this person's identity while we were working --
    // return theirs rather than a second.
    if (/user_id/.test(error.message)) {
      const theirs = await getIdentity(admin, args.userId);
      if (theirs) return {
        ok: true,
        data: { id: theirs.id, practitionerNumber: theirs.practitioner_number, handle: theirs.handle, created: false },
      };
    }
    if (!/duplicate|unique/i.test(error.message))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }
  return { ok: false, status: 409, code: "NUMBER_UNAVAILABLE", message: "could not allocate a practitioner number" };
}

/**
 * Change a handle.
 *
 * s3: availability checks, and automatic legacy redirects. THE OLD HANDLE IS RETIRED, NOT FREED -- it
 * goes to practice_handle_history so that the printed cards and posters carrying it keep working, and so
 * nobody else can claim it.
 */
/**
 * Why a handle was refused, in the practitioner's words.
 *
 * ⚠ `reserved` DOES NOT SAY WHY THAT PARTICULAR NAME IS RESERVED. practice_reserved_handle holds a
 * `reason` column -- platform, brand, profession, routing -- and repeating it back would tell somebody
 * probing the namespace which names the operator cares about and why. "It is not available" is the whole
 * of what a caller is owed.
 */
const REFUSAL: Record<string, { code: string; status: number; message: string }> = {
  invalid: {
    code: "HANDLE_INVALID", status: 400,
    message: "a handle is 3 to 30 characters, starts with a letter, and uses only lowercase letters and numbers",
  },
  reserved: { code: "HANDLE_RESERVED", status: 409, message: "that handle is not available" },
  taken: { code: "HANDLE_TAKEN", status: 409, message: "that handle is in use" },
  retired: {
    code: "HANDLE_RETIRED", status: 409,
    message: "that handle used to belong to somebody else, and stays with them so their printed codes keep working",
  },
  unreadable: {
    code: "HANDLE_UNREADABLE", status: 503,
    message: "whether that handle is free could not be checked just now, so nothing was changed",
  },
};

/**
 * ⚠ A UNIQUE VIOLATION ON THE HANDLE COLUMN IS "SOMEBODY ELSE GOT IT FIRST", NOT AN INTERNAL ERROR.
 *
 * handleAvailable() cannot settle a race -- two claims of the same free name both read "available" and
 * both proceed. The unique constraint from migration 218 is the only thing that can, so the write is
 * attempted and ITS refusal is the answer. Returning the raw Postgres message instead would both leak
 * the constraint's name and tell the loser nothing they could act on.
 */
type Refused = { ok: false; status: number; code: string; message: string };

const writeRefusal = (error: { code?: string; message: string }): Refused => {
  if (error.code === "23505" || /duplicate|unique/i.test(error.message))
    return { ok: false, ...REFUSAL.taken };
  return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
};

export async function changeHandle(admin: any, args: {
  userId: string; handle: string; correlationId: string;
}): Promise<EngineResult<{ handle: string; previous: string | null }>> {
  const identity = await getIdentity(admin, args.userId);
  if (!identity) return { ok: false, status: 404, code: "NO_IDENTITY", message: "no identity has been issued" };

  const h = normaliseHandle(args.handle);
  const check = await handleAvailable(admin, h, identity.id);
  if (!check.available) return { ok: false, ...REFUSAL[check.reason ?? "invalid"] };
  if (identity.handle === h) return { ok: true, data: { handle: h, previous: null } };

  const previous: string | null = identity.handle ?? null;
  if (previous) {
    const { error: historyError } = await admin.from("practice_handle_history")
      .insert({ handle: previous, identity_id: identity.id });
    // THE HISTORY WRITE COMES FIRST AND ITS FAILURE STOPS THE CHANGE. Freeing the old handle without
    // recording it would break every poster carrying it and leave it claimable by somebody else.
    if (historyError && !/duplicate|unique/i.test(historyError.message))
      return { ok: false, status: 500, code: "HISTORY_FAILED", message: `the old handle could not be retired, so nothing was changed: ${historyError.message}` };
  }

  const { data: updated, error } = await admin.from("practice_practitioner_identity")
    .update({ handle: h, updated_at: nowIso() }).eq("id", identity.id).select("id");
  if (error) return writeRefusal(error);
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: identity.primary_workspace_id, actorId: args.userId, eventType: "practice.handle_changed",
    payload: { identityId: identity.id, from: previous, to: h }, correlationId: args.correlationId,
  });
  return { ok: true, data: { handle: h, previous } };
}

/**
 * CLAIM the first handle -- the deliberate act that gives a practitioner a public address.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ SEPARATE FROM changeHandle BECAUSE IT IS A DIFFERENT ACT WITH A DIFFERENT COST.
 *
 * A CHANGE retires the outgoing handle into practice_handle_history, where it stays claimed for ever. A
 * CLAIM retires nothing: there is no previous name, so the namespace is not consumed twice. Refusing to
 * let this function overwrite an existing handle keeps that true -- a screen that "claimed" over the top
 * would silently retire a name and the practitioner would find out from a dead poster.
 *
 * ⚠ THE WRITE IS THE COLLISION CHECK, NOT THE READ ABOVE IT. `.is("handle", null)` in the update is what
 * makes this idempotent-safe against this identity being claimed twice concurrently, and the unique
 * constraint is what settles two DIFFERENT identities racing for the same name. Neither is a check
 * followed by a write. This codebase has been bitten three times by that pattern -- most recently a
 * one-time code accepted ten times under concurrency -- so the read below exists only for the two rules
 * the database cannot enforce (reserved, and retired by somebody else), and its failure is a refusal.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
/**
 * The handle a booking page for this workspace should carry, for a page created AFTER its owner
 * claimed one. claimHandle writes onto a page that already exists; this is the other order of the
 * same two acts, and without it the result would depend on which the practitioner did first.
 *
 * ⚠ ZERO AND SEVERAL BOTH RESOLVE TO NULL, AND THE SECOND IS NOT AN OVERSIGHT. One page carries
 * one handle (ux_practice_booking_access_handle), so when two practitioners both point their identity
 * at this workspace there is no non-arbitrary way to choose between them -- and picking the older row
 * would put one clinician's personal address on a practice both of them work in. Nothing is written,
 * the readiness check keeps saying no handle is on the page, and a person decides.
 */
/**
 * ⚠ AN UNREADABLE ANSWER IS NOT AN EMPTY ONE, and in THIS function that distinction is the entire bug
 * this arc exists to close. It used to destructure only `data` and then fall back to an empty array, so
 * a failed read produced NO CLAIMED HANDLES -- and the publish readiness check turns that into the
 * sentence "no handle has been claimed, so there is no address a patient could be given."
 *
 * That is, word for word, the false sentence somebody reported from their own screen while Practice Setup
 * displayed @elisham1 in the header two clicks away. Migration 348 fixed the cause; discarding this error
 * reproduced the SYMPTOM on any transient failure, in the one function whose whole job is to answer
 * "has a handle been claimed?". The caller comment even says this read "is the difference between a true
 * sentence and a false one" -- and then threw away the error that decides which.
 */
export type ClaimedHandles =
  | { ok: true; handles: string[] }
  | { ok: false; detail: string };

export async function claimedHandlesForWorkspace(admin: any, workspaceId: string): Promise<ClaimedHandles> {
  // Two is enough to tell none from one from several, which is all any caller needs to decide or to
  // explain itself. Reading every identity in a large practice to answer a yes/no would be waste.
  const { data, error } = await admin.from("practice_practitioner_identity")
    .select("handle").eq("primary_workspace_id", workspaceId).not("handle", "is", null).limit(2);
  if (error) return { ok: false, detail: error.message };
  return { ok: true, handles: ((data ?? []) as { handle: string }[]).map(r => r.handle) };
}

/**
 * Null for zero, for several, AND for a read that failed -- three different reasons, one safe answer,
 * because every one of them means we cannot name the single handle this page should carry. Writing a
 * handle we could not confirm is the only outcome here that could put one clinician address on another
 * clinician page, so this fails closed. Callers that need to EXPLAIN the null ask
 * claimedHandlesForWorkspace directly and get the reason.
 */
export async function handleForWorkspace(admin: any, workspaceId: string): Promise<string | null> {
  const claimed = await claimedHandlesForWorkspace(admin, workspaceId);
  return claimed.ok && claimed.handles.length === 1 ? claimed.handles[0] : null;
}

export type HandleAdoption = "adopted" | "no_workspace" | "no_page" | "page_has_handle" | "refused";

/**
 * Put a freshly claimed handle onto the practice's booking page.
 *
 * Migration 254 made practice_booking_access.handle a foreign key onto the identity's handle, ON UPDATE
 * CASCADE -- so CHANGING a handle later moves the booking page with it, in the database, with no code
 * involved. What nothing ever performed was the FIRST write. The column stayed null for every practice
 * that ever existed, which made HANDLE_CLAIMED unsatisfiable through the product: a blocker on the
 * publish path that no amount of using the product could clear, telling a practitioner who had claimed
 * @elisham1 that no handle had been claimed.
 *
 * `is("handle", null)` is the same guard the identity write above uses, for the same reason: it must
 * never take a page that already carries somebody's address.
 */
export async function adoptHandleOntoBookingPage(
  admin: any, workspaceId: string | null, handle: string,
): Promise<HandleAdoption> {
  if (!workspaceId) return "no_workspace";
  const { data, error } = await admin.from("practice_booking_access")
    .update({ handle, updated_at: nowIso() })
    .eq("workspace_id", workspaceId).is("handle", null).select("id");
  if (error) return "refused";
  if (data && data.length > 0) return "adopted";
  // Zero rows and no error: the guard held. Which of the two reasons it was decides whether anything
  // still needs to happen -- no page means the seed on creation will pick the handle up, a page that
  // already has one means a person has to choose. They are not the same outcome and are not logged as one.
  const { data: page } = await admin.from("practice_booking_access")
    .select("id").eq("workspace_id", workspaceId).maybeSingle();
  return page ? "page_has_handle" : "no_page";
}

export async function claimHandle(admin: any, args: {
  userId: string; handle: string; correlationId: string;
}): Promise<EngineResult<{ handle: string; bookingUrl: string }>> {
  const identity = await getIdentity(admin, args.userId);
  if (!identity)
    return { ok: false, status: 404, code: "NO_IDENTITY", message: "no identity has been issued for you yet" };
  if (identity.handle)
    return {
      ok: false, status: 409, code: "HANDLE_ALREADY_CLAIMED",
      message: `you already have @${identity.handle}. Changing it retires the old one permanently, which is a different decision from claiming your first.`,
    };

  const h = normaliseHandle(args.handle);
  const check = await handleAvailable(admin, h, identity.id);
  if (!check.available) return { ok: false, ...REFUSAL[check.reason ?? "invalid"] };

  const { data: updated, error } = await admin.from("practice_practitioner_identity")
    .update({ handle: h, updated_at: nowIso() })
    .eq("id", identity.id).is("handle", null).select("id, handle");
  if (error) return writeRefusal(error);
  // Zero rows and no error means the `is null` guard held: this identity acquired a handle between the
  // read and the write. Reported as already claimed rather than as a mysterious not-found.
  if (!updated || updated.length === 0)
    return {
      ok: false, status: 409, code: "HANDLE_ALREADY_CLAIMED",
      message: "a handle was claimed for you a moment ago, so this one was not written",
    };

  // ⚠ THIS MUST NOT BE ABLE TO REFUSE THE CLAIM. The identity write above has already committed, so
  // the handle IS claimed whatever happens here; returning a failure would tell the practitioner
  // otherwise and leave them unable to retry, because the second attempt hits HANDLE_ALREADY_CLAIMED.
  // The outcome is carried into the audit payload instead -- a null that nobody could see is the exact
  // defect this call exists to fix, and it would be a poor fix that failed the same way.
  const adoption = await adoptHandleOntoBookingPage(admin, identity.primary_workspace_id, h);

  await audit(admin, {
    workspaceId: identity.primary_workspace_id, actorId: args.userId,
    eventType: "practice.handle_claimed",
    payload: { identityId: identity.id, handle: h, bookingUrl: bookingUrl(h), bookingPage: adoption },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { handle: h, bookingUrl: bookingUrl(h) } };
}

/**
 * The name an identity is issued under, when nobody has typed one for this call.
 *
 * ⚠ THIS IS NOT A PUBLIC NAME AND ISSUING IT PUBLISHES NOTHING. display_name is NOT NULL on the identity
 * (migration 218), the row is created `hidden`, and resolveHandle refuses a hidden identity -- so the
 * name sits privately against the row until its owner both claims a handle and changes their discovery
 * mode. That is two deliberate acts away from a stranger being able to read it.
 *
 * The platform profile first, because that is the name the person themselves entered. The workspace name
 * second, and ONLY for an individual practice, where provisioning set it from the practitioner's own
 * stated display name. A managed practice is called something that is not a person, and issuing an
 * identity under a clinic's name would put a business where a clinician belongs -- so it returns null and
 * the caller has to ask.
 */
export async function resolveDisplayName(
  admin: any, userId: string, workspaceId: string | null,
): Promise<string | null> {
  const { data: profile } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  const fromProfile = (profile?.full_name ?? "").trim();
  if (fromProfile.length >= 2) return fromProfile;

  if (!workspaceId) return null;
  const { data: ws } = await admin.from("practice_workspace")
    .select("name, type").eq("id", workspaceId).maybeSingle();
  if (ws?.type !== "individual_practice") return null;
  const fromWorkspace = (ws?.name ?? "").trim();
  return fromWorkspace.length >= 2 ? fromWorkspace : null;
}

// ── WHAT PRACTICE SETUP SHOWS ────────────────────────────────────────────────────────────────────────

/**
 * ⚠ EVERY FIELD IS A STRING, A BOOLEAN, A NUMBER, NULL, OR AN ARRAY OF THOSE. NOTHING IS A FUNCTION.
 *
 * This payload is handed from a server component to a client one. A method on it type-checks, passes
 * eslint, passes every harness and kills the page at runtime -- which is exactly how the Follow-ups
 * board died this week. The harness walks this object and asserts the same thing, because a rule that is
 * only a comment is a rule that lasts until the next field is added.
 */
export type IdentitySetupView = {
  /**
   * The three states, kept apart. `none` is "no identity row exists", which is a real and recoverable
   * situation for a practice provisioned before issuance was wired in -- NOT an error, and NOT the same
   * as `unclaimed`.
   */
  state: "none" | "unclaimed" | "claimed" | "unreadable";
  /** Populated only for `unreadable`. A failed read says so instead of rendering as "you have nothing". */
  reason: string | null;

  practitionerNumber: string | null;
  displayName: string | null;
  handle: string | null;
  bookingUrl: string | null;
  discovery: string | null;
  identityStatus: string | null;

  /** The host a claimed handle would hang off, so the screen can show the shape before anything is typed. */
  host: string;
  /**
   * ⚠ EVERYTHING BEFORE THE HANDLE, COMPOSED ON THE SERVER, so the live preview in the claim box is not a
   * SECOND construction of the booking link. It used to read `${view.host}/@${typed}` in the console --
   * one string literal away from previewing an address the application does not serve, and the reader of
   * that line had no way to know the path had moved.
   */
  urlPrefix: string;
  /**
   * ⚠ CPB-002's sharing workspace. NULL UNLESS THE ADDRESS ACTUALLY OPENS -- see `address` below.
   *
   * This used to be populated on `if (row.handle)` alone, which meant the moment a handle was claimed the
   * console offered a QR code, a print button and WhatsApp, Facebook and LinkedIn share links for a URL
   * that resolveHandle refuses. Every identity in this deployment is `created` and `hidden`, so that was
   * every practitioner who ever claimed one: invited to print a dead address onto a card and post it
   * publicly. A screen can be redeployed; a box of cards cannot.
   */
  sharing: IdentitySharing | null;
  /**
   * ⚠ DOES THE ADDRESS ACTUALLY OPEN? ANSWERED BY resolveHandle ITSELF.
   *
   * Not by re-checking its two conditions here -- a copy drifts the moment RESOLVABLE_STATES changes, and
   * the drift is silent in the direction that matters. `remaining` explains a refusal the resolver has
   * already made; it never makes one.
   */
  address: {
    state: "no_handle" | "resolves" | "does_not_resolve" | "unreadable";
    /** Why, when there is a why beyond the steps in `remaining`. Null when `remaining` says it all. */
    reason: string | null;
    /** What is still standing in the way, each a fact about this identity as it is right now. */
    remaining: string[];
  };
  /** s7's modes, as plain data, so the client renders the same five the engine validates against. */
  discoveryModes: { key: string; label: string; detail: string }[];
  /** ⚠ THE REAL SIGNAL BEHIND email_verified, shown before the button rather than after the refusal. */
  emailConfirmed: EmailConfirmation;
  /** The public profile fields as they stand, so an edit form is not a blank that erases them. */
  publicProfile: {
    qualifications: string; specialties: string; subSpecialty: string; biography: string;
    languages: string; consultationTypes: string;
    /** s4: the stored object path, null until one is uploaded. The URL is composed by practitioner-photo. */
    photoPath: string | null;
  };
  /** What a claim costs, in the words the harness also checks. */
  permanenceNotice: string;
  /** What publishing discloses, in the words the harness also checks. */
  publicationNotice: string;

  /**
   * Candidates s3's algorithm produced THAT ARE ACTUALLY FREE. Offered, never applied -- and the
   * distinction is the whole point of this build.
   */
  suggestions: string[];
  /** True when at least one candidate could not be checked, so the list may be short rather than complete. */
  suggestionsIncomplete: boolean;

  /**
   * The booking page, which is a different thing from the address. Reported honestly: this build has no
   * surface that creates or publishes one, and migration 254's `practice_booking_access_publishable`
   * constraint -- not this code -- is what refuses a published page with no handle.
   */
  bookingPage: {
    state: "absent" | "present" | "unreadable";
    reason: string | null;
    publishState: string | null;
    handle: string | null;
  };
};

/**
 * CPB-002's "Booking & Sharing Workspace", as a payload.
 *
 * ⚠ EVERY FIELD IS A STRING, A BOOLEAN OR AN ARRAY OF PLAIN OBJECTS. NOTHING IS A FUNCTION. The QR is a
 * finished SVG and a finished data URL rather than a generator, because a method on a payload handed to
 * a client component type-checks, passes eslint, passes every harness and kills the page at runtime.
 */
export type IdentitySharing = {
  /** ⚠ THE ONE STRING. The QR encodes this, the targets carry this, the print sheet prints this. */
  url: string;
  handle: string;
  /** Drawn in this process. No external image service ever sees a practitioner's booking address. */
  qrSvg: string;
  qrPngDataUrl: string;
  targets: ShareTarget[];
  embed: string;
  /** Where the printable card, business card and poster live. In-application, so it needs no host. */
  printPath: string;
  /** ⚠ NOTHING HERE SENDS ANYTHING, and it is a field so a screen cannot imply otherwise. */
  sentByThisProduct: false;
  /** CPB-002 asks for PDF as well as PNG and SVG. See NOT_BUILT's `qr_pdf`. */
  pdfNote: string;
};

/**
 * Build the sharing workspace for a claimed handle.
 *
 * ⚠ IT REFUSES TO GUESS. Called only with a handle that has actually been claimed; there is nothing to
 * share before that, and a preview of a share sheet for an address nobody holds would be a screen
 * inviting a practitioner to distribute a link that resolves to nothing.
 */
export async function identitySharing(displayName: string, handle: string): Promise<IdentitySharing> {
  const share = shareTargets(displayName, handle);
  return {
    url: share.url,
    handle,
    qrSvg: await bookingQr(handle, "svg"),
    qrPngDataUrl: await bookingQr(handle, "png"),
    targets: share.targets,
    embed: embedSnippet(displayName, handle),
    printPath: `${bookingPath(handle)}/print`,
    sentByThisProduct: false,
    pdfNote: NOT_BUILT.find(n => n.key === "qr_pdf")!.detail,
  };
}

/** How many name candidates are worth offering. Enough to choose from, few enough to read. */
const SUGGESTION_LIMIT = 5;

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE BOOKING LINK, WHERE A PRACTITIONER ACTUALLY IS. (Owner, 2026-08-28: "Where do we find the
// booking link? Can we make it very easy to find.")
//
// A light summary for surfaces that are not the identity console -- the Command Centre, the publish
// checklist's neighbourhood. It reuses this file's ONE url constructor and asks resolveHandle itself
// whether the address opens, because the sharing defect this file's history records is precisely a
// screen offering an address a patient cannot open. `live` is the only state that carries a URL a
// screen may offer to copy or share; `claimed_not_open` carries it for RECOGNITION ONLY, and the
// screen must say the address does not open yet rather than offer share affordances for it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type BookingLinkSummary =
  | { state: "unreadable"; reason: string }
  | { state: "none" }
  | { state: "claimed_not_open"; handle: string; url: string }
  | { state: "live"; handle: string; url: string };

export async function bookingLinkSummary(admin: any, userId: string): Promise<BookingLinkSummary> {
  try {
    const { data: row, error } = await admin.from("practice_practitioner_identity")
      .select("handle, discovery, status")
      .eq("user_id", userId).maybeSingle();
    if (error) return { state: "unreadable", reason: error.message };
    if (!row?.handle) return { state: "none" };
    const address = addressState(await resolveHandle(admin, row.handle), row);
    if (address.state === "unreadable")
      return { state: "unreadable", reason: address.reason ?? "whether your address opens could not be checked" };
    return address.state === "resolves"
      ? { state: "live", handle: row.handle, url: bookingUrl(row.handle) }
      : { state: "claimed_not_open", handle: row.handle, url: bookingUrl(row.handle) };
  } catch (e) {
    return { state: "unreadable", reason: e instanceof Error ? e.message : "the read failed" };
  }
}

/**
 * Turn the resolver's answer into something a screen can act on, WITHOUT SECOND-GUESSING IT.
 *
 * ⚠ `reach` DECIDES. The row is read only to say what is still true, and the wording uses the same
 * RESOLVABLE_STATES the resolver uses, so the explanation cannot describe a rule that has moved.
 */
function addressState(
  reach: Awaited<ReturnType<typeof resolveHandle>>, row: { discovery: string; status: string },
): IdentitySetupView["address"] {
  if (reach.kind === "unreadable")
    return {
      state: "unreadable",
      reason: `whether your address opens could not be checked just now, so nothing on this page says that it does -- ${reach.reason}`,
      remaining: [],
    };
  if (reach.kind === "found") return { state: "resolves", reason: null, remaining: [] };

  const remaining: string[] = [];
  if (row.discovery === "hidden")
    remaining.push(
      "Your discovery setting is hidden, which is where every identity starts. Nobody can reach your page, by search or by link.",
    );
  if (!RESOLVABLE_STATES.has(row.status))
    remaining.push(
      `Your identity is ${row.status}. Only an identity that is ${[...RESOLVABLE_STATES].join(" or ")} can be opened by a patient.`,
    );
  return {
    state: "does_not_resolve",
    // ⚠ THE CASE WHERE THE EXPLANATION RUNS OUT, SAID RATHER THAN PAPERED OVER. If the resolver refuses
    // for a reason neither field accounts for, the honest answer is that we do not know why -- not
    // silence, and certainly not a share sheet.
    reason: remaining.length > 0 ? null
      : "Your address does not open, and neither your discovery setting nor your status explains why. Nothing here should be shared until that is understood.",
    remaining,
  };
}

export async function identitySetupView(admin: any, args: {
  userId: string; workspaceId: string; fallbackDisplayName?: string | null;
}): Promise<IdentitySetupView> {
  const host = identityHost();
  const base = {
    reason: null as string | null,
    practitionerNumber: null as string | null,
    displayName: null as string | null,
    handle: null as string | null,
    bookingUrl: null as string | null,
    discovery: null as string | null,
    identityStatus: null as string | null,
    host,
    // ⚠ ONE CONSTRUCTION, ON THE SERVER. See the field's own note.
    urlPrefix: `${host}${BOOKING_PATH}@`,
    sharing: null as IdentitySharing | null,
    address: { state: "no_handle", reason: null, remaining: [] } as IdentitySetupView["address"],
    // ⚠ COPIED OUT OF THE FROZEN TUPLE INTO PLAIN OBJECTS. DISCOVERY_MODES is `as const`, and handing a
    // readonly tuple to a client component through a typed payload is a type argument nobody needs.
    discoveryModes: DISCOVERY_MODES.map(m => ({ key: m.key as string, label: m.label as string, detail: m.detail as string })),
    emailConfirmed: await authEmailConfirmation(admin, args.userId),
    publicProfile: {
      qualifications: "", specialties: "", subSpecialty: "", biography: "", languages: "", consultationTypes: "",
      photoPath: null,
    },
    permanenceNotice: HANDLE_PERMANENCE_NOTICE,
    publicationNotice: PUBLICATION_NOTICE,
    suggestions: [] as string[],
    suggestionsIncomplete: false,
  };

  const bookingPage = await bookingPageState(admin, args.workspaceId);

  const { data: row, error } = await admin.from("practice_practitioner_identity")
    // ⚠ `*` RATHER THAN A COLUMN LIST, AND THE REASON IS SEQUENCING. Migrations here are applied by
    // hand, so between a deploy and the owner running one the column named in a list DOES NOT EXIST --
    // and PostgREST fails the WHOLE query, which this function reports as "your identity could not be
    // read". A screen that breaks until somebody runs SQL is a worse outcome than a field that reads as
    // null for an hour. Nothing extra is serialised: the typed view below is built field by field.
    .select("*")
    .eq("user_id", args.userId).maybeSingle();
  // ⚠ A FAILED READ IS NOT "YOU HAVE NO IDENTITY". Reporting it as `none` would offer a practitioner a
  // button that issues a SECOND permanent number the moment the database answered again.
  if (error) return {
    ...base, state: "unreadable", reason: error.message, bookingPage,
    // ⚠ AND THE ADDRESS IS UNREADABLE TOO, not "you have no handle". The same failed read cannot be
    // honest about the identity and confident about its address.
    address: { state: "unreadable", reason: error.message, remaining: [] },
  };

  if (!row) {
    return {
      ...base, state: "none", displayName: args.fallbackDisplayName ?? null, bookingPage,
      address: {
        state: "no_handle", reason: null,
        remaining: ["No identity has been issued to you yet, so there is no address and nothing to publish."],
      },
    };
  }

  const publicProfile = {
    qualifications: row.qualifications ?? "", specialties: row.specialties ?? "", subSpecialty: row.sub_specialty ?? "",
    biography: row.biography ?? "", languages: row.languages ?? "",
    consultationTypes: row.consultation_types ?? "",
    photoPath: (row.photo_path as string | null) ?? null,
  };

  if (row.handle) {
    // ⚠ THE GATE, ASKED RATHER THAN REPRODUCED. The share sheet is built only for an address a patient
    // could actually open, because everything in it -- the QR, the print sheet, the WhatsApp link -- ends
    // up somewhere this product cannot reach to correct it.
    const address = addressState(await resolveHandle(admin, row.handle), row);
    return {
      ...base, state: "claimed",
      practitionerNumber: row.practitioner_number, displayName: row.display_name,
      handle: row.handle, bookingUrl: bookingUrl(row.handle),
      discovery: row.discovery, identityStatus: row.status,
      address, publicProfile,
      sharing: address.state === "resolves"
        ? await identitySharing(row.display_name ?? "", row.handle)
        : null,
      bookingPage,
    };
  }

  const free: string[] = [];
  let incomplete = false;
  for (const candidate of handleCandidates(row.display_name ?? "", 24)) {
    if (free.length >= SUGGESTION_LIMIT) break;
    const check = await handleAvailable(admin, candidate);
    if (check.available) free.push(candidate);
    else if (check.reason === "unreadable") { incomplete = true; break; }
  }

  return {
    ...base, state: "unclaimed",
    practitionerNumber: row.practitioner_number, displayName: row.display_name,
    discovery: row.discovery, identityStatus: row.status,
    // ⚠ `no_handle` IS NOT `does_not_resolve`. There is no address yet, so there is nothing to ask the
    // resolver about -- and nothing for a screen to describe as broken.
    address: {
      state: "no_handle", reason: null,
      remaining: ["You have not claimed a handle, so there is no address for a patient to open."],
    },
    publicProfile,
    suggestions: free, suggestionsIncomplete: incomplete,
    bookingPage,
  };
}

/**
 * Is there a booking-page profile for this practice, and what state is it in?
 *
 * ⚠ ABSENT IS NOT UNREADABLE, AND NEITHER IS AN ERROR. Migration 254 created practice_booking_access;
 * nothing in this build writes to it, so `absent` is the honest answer for every practice today. A
 * missing TABLE (PGRST205) is reported as absent too -- a deployment that has not applied 254 has no
 * booking page in exactly the sense that matters here -- while any other failure is `unreadable`.
 */
async function bookingPageState(admin: any, workspaceId: string): Promise<IdentitySetupView["bookingPage"]> {
  const { data, error } = await admin.from("practice_booking_access")
    .select("handle, publish_state").eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    if (error.code === "PGRST205" || /could not find the table/i.test(error.message ?? ""))
      return { state: "absent", reason: "the booking-page store is not present in this deployment", publishState: null, handle: null };
    return { state: "unreadable", reason: error.message, publishState: null, handle: null };
  }
  if (!data) return { state: "absent", reason: null, publishState: null, handle: null };
  return { state: "present", reason: null, publishState: data.publish_state ?? null, handle: data.handle ?? null };
}

/** The public profile fields (s6) and the discovery mode (s7). All practitioner-controlled. */
export async function updateIdentity(admin: any, args: {
  userId: string; displayName?: string; qualifications?: string; specialties?: string; subSpecialty?: string;
  biography?: string; languages?: string; consultationTypes?: string;
  discovery?: string; primaryWorkspaceId?: string | null; correlationId: string;
}): Promise<EngineResult<{ id: string; discovery: string }>> {
  const identity = await getIdentity(admin, args.userId);
  if (!identity) return { ok: false, status: 404, code: "NO_IDENTITY", message: "no identity has been issued" };

  if (args.discovery && !DISCOVERY_MODES.some(m => m.key === args.discovery))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `discovery must be one of: ${DISCOVERY_MODES.map(m => m.key).join(", ")}` };

  // GOING PUBLIC NEEDS A NAME AND A HANDLE. A public listing with neither is a page that cannot be found
  // and cannot be identified, and it would still have published the row.
  if (args.discovery === "public" && !identity.handle)
    return { ok: false, status: 409, code: "NO_HANDLE", message: "choose a handle before listing publicly -- a public page needs an address" };

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  const map: Record<string, string> = {
    displayName: "display_name", qualifications: "qualifications", specialties: "specialties", subSpecialty: "sub_specialty",
    biography: "biography", languages: "languages", consultationTypes: "consultation_types",
    discovery: "discovery",
  };
  for (const [k, column] of Object.entries(map)) {
    const v = (args as any)[k];
    if (v !== undefined) patch[column] = typeof v === "string" ? (v.trim() || null) : v;
  }
  if (args.primaryWorkspaceId !== undefined) patch.primary_workspace_id = args.primaryWorkspaceId;
  if (patch.display_name === null)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a display name is required" };

  const { data: updated, error } = await admin.from("practice_practitioner_identity")
    .update(patch).eq("id", identity.id).select("id, discovery");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (args.discovery && args.discovery !== identity.discovery) {
    await audit(admin, {
      workspaceId: identity.primary_workspace_id, actorId: args.userId,
      eventType: "practice.discovery_changed",
      // BOTH VALUES, so "why did my page become findable" has an answer.
      payload: { identityId: identity.id, from: identity.discovery, to: args.discovery },
      correlationId: args.correlationId,
    });
  }
  return { ok: true, data: { id: identity.id, discovery: updated[0].discovery } };
}

/** s10's lifecycle. Forward-only, except that a temporary hide can be undone. */
const TRANSITIONS: Record<string, string[]> = {
  created: ["email_verified", "suspended", "archived"],
  email_verified: ["licence_verified", "active", "suspended", "archived"],
  licence_verified: ["active", "suspended", "archived"],
  active: ["temporarily_hidden", "suspended", "archived"],
  temporarily_hidden: ["active", "suspended", "archived"],
  suspended: ["active", "archived"],
  archived: ["deleted"],
  deleted: [],
};

export async function transitionIdentity(admin: any, args: {
  userId: string; to: string; actorId: string; licenceReference?: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const identity = await getIdentity(admin, args.userId);
  if (!identity) return { ok: false, status: 404, code: "NO_IDENTITY", message: "no identity has been issued" };

  const allowed = TRANSITIONS[identity.status] ?? [];
  if (!allowed.includes(args.to))
    return {
      ok: false, status: 409, code: "ILLEGAL_TRANSITION",
      message: `an identity that is ${identity.status} cannot become ${args.to}${allowed.length ? ` -- only ${allowed.join(", ")}` : ""}`,
    };

  const patch: Record<string, unknown> = { status: args.to, updated_at: nowIso() };
  if (args.to === "licence_verified") {
    // WHO CHECKED, AND WHEN. Nothing here contacts a council; what makes this state true is a person
    // recording that they looked, and their id stays against it. See NOT_BUILT.
    patch.licence_verified_at = nowIso();
    patch.licence_verified_by = args.actorId;
    patch.licence_reference = args.licenceReference?.trim() || null;
  }

  const { data: updated, error } = await admin.from("practice_practitioner_identity")
    .update(patch).eq("id", identity.id).select("id, status");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: identity.primary_workspace_id, actorId: args.actorId,
    eventType: "practice.identity_transitioned",
    payload: { identityId: identity.id, from: identity.status, to: args.to },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.to } };
}

// ── PUBLICATION ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Is the sign-in email of THIS user confirmed?
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THE ONLY HONEST WAY TO REACH `email_verified`, AND THE REASON THE ALTERNATIVE WAS REFUSED.
 *
 * s10 makes `email_verified` the only step out of `created`, so it sits on the critical path to a working
 * address -- which makes a button labelled "my email is verified" the obvious build. It is also a button
 * that writes a state meaning "somebody checked" on the word of the person being checked. The state would
 * then be a lie held in a column the rest of the system trusts.
 *
 * So it is DERIVED from the real signal: auth.users.email_confirmed_at, read through the service-role
 * client for one id. No practitioner input reaches this function, and nothing here can be argued with.
 *
 * ⚠ FOUR STATES, AND EVERY ONE OF THEM THAT IS NOT `confirmed` REFUSES. A missing account and a failed
 * read are kept apart from an unconfirmed address because they need different sentences and different
 * status codes -- but none of them is ever treated as "probably fine".
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export type EmailConfirmation = {
  state: "confirmed" | "unconfirmed" | "no_account" | "unreadable";
  confirmedAt: string | null;
  /** Populated for everything except `confirmed`. What is wrong, in the practitioner's words. */
  reason: string | null;
};

export const EMAIL_UNCONFIRMED_NOTICE =
  "The email address you sign in with has not been confirmed, so nothing can record it as verified and "
  + "your address cannot be published. Competen sent a confirmation link when your account was created -- "
  + "open that, or ask for it to be sent again, and then come back here. Nothing has been changed.";

export async function authEmailConfirmation(admin: any, userId: string): Promise<EmailConfirmation> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) {
      // 404 is "there is no such auth user", which is a different thing from "the directory would not
      // answer" -- and for a caller who has just authenticated it should be impossible. Said plainly
      // rather than folded into either neighbour.
      if ((error as any).status === 404)
        return {
          state: "no_account", confirmedAt: null,
          reason: "no sign-in account could be found for you, so there is no email address to confirm",
        };
      return { state: "unreadable", confirmedAt: null, reason: error.message };
    }
    const user = data?.user;
    if (!user)
      return {
        state: "no_account", confirmedAt: null,
        reason: "no sign-in account could be found for you, so there is no email address to confirm",
      };
    const at = (user.email_confirmed_at ?? null) as string | null;
    return at
      ? { state: "confirmed", confirmedAt: at, reason: null }
      : { state: "unconfirmed", confirmedAt: null, reason: EMAIL_UNCONFIRMED_NOTICE };
  } catch (e) {
    // ⚠ A THROW IS `unreadable`, NOT `unconfirmed`. Both refuse, but only one of them is a statement
    // about the practitioner's account, and telling somebody their email is unconfirmed when the
    // directory simply did not answer sends them off to fix something that is not broken.
    return { state: "unreadable", confirmedAt: null, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * ⚠ WHAT PUBLISHING DISCLOSES, IN ONE SENTENCE THE SCREEN AND THE HARNESS BOTH READ.
 *
 * Same reasoning as HANDLE_PERMANENCE_NOTICE: a warning that lives only in JSX is one a redesign drops
 * with nothing failing, and this one is the difference between a practitioner who chose to be findable
 * and one who pressed a button.
 */
export const PUBLICATION_NOTICE =
  "Publishing opens your booking page at your address. Anybody holding the link -- from a card, a poster, "
  + "a QR code or a message -- reaches a page carrying your name, your practitioner number, and whichever "
  + "qualifications, specialties, sub-specialty, languages, consultation types and biography you have filled "
  + "in. Listing "
  + "publicly does that AND puts those details into Competen's practitioner search, where strangers can "
  + "find you without a link. You can return to hidden whenever you like and the page stops opening "
  + "immediately -- but your handle is never released, and a card already printed or a page already read "
  + "cannot be recalled.";

/** The named steps between an issued identity and an address that opens. Reported, in this order. */
export const PUBLISH_STEPS = ["email_confirmed", "email_verified", "active", "discovery"] as const;
export type PublishStep = typeof PUBLISH_STEPS[number];

export type PublishOutcome = {
  status: string;
  discovery: string;
  bookingUrl: string;
  /** Steps this call performed. */
  completed: PublishStep[];
  /** Steps that were already true, so nothing was written for them. */
  alreadyTrue: PublishStep[];
  /** ⚠ ASKED OF resolveHandle AFTERWARDS, not inferred from the writes above having returned ok. */
  address: "resolves" | "does_not_resolve" | "unreadable";
  addressReason: string | null;
};

export type PublishResult =
  | { ok: true; data: PublishOutcome }
  /** ⚠ A FAILURE CARRIES HOW FAR IT GOT. A half-run that reports only its last error leaves a
   *  practitioner unable to tell whether their lifecycle moved, and the next attempt looks like a
   *  different bug. */
  | { ok: false; status: number; code: string; message: string; completed: PublishStep[]; alreadyTrue: PublishStep[] };

/**
 * PIS-000 s7, s10 -- take an identity from issued-and-private to an address that actually opens.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THE ORDER IS THE WHOLE FUNCTION, AND EACH STEP HAS A DIFFERENT REASON FOR BEING WHERE IT IS.
 *
 *   1. A HANDLE FIRST. updateIdentity already refuses `public` without one; this refuses every mode
 *      without one, because a discovery setting on an identity with no address changes nothing a patient
 *      could reach and would leave somebody believing they had published.
 *   2. THE EMAIL, READ RATHER THAN ASSERTED. See authEmailConfirmation.
 *   3. THE LIFECYCLE, ONE LEGAL STEP AT A TIME, through transitionIdentity so s10's table stays the only
 *      thing that decides what may follow what.
 *   4. THE DISCOVERY MODE LAST. If any earlier step refuses, the identity is still hidden -- which is the
 *      safe direction to fail in, and the reason this order is not merely tidy.
 *
 * ⚠ AND `licence_verified` IS NOT ON THE PATH. s10 allows email_verified -> licence_verified, and this
 * function deliberately steps around it to `active` instead. transitionIdentity writes
 * licence_verified_by = actorId, and the only actor this function ever has is the practitioner
 * themselves: a self-awarded record that somebody checked a licence is worse than no record at all,
 * because everything downstream reads it as provenance. Verification is an operator's act and has no
 * practitioner-facing door, here or anywhere.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export async function publishIdentity(admin: any, args: {
  userId: string; discovery: string; correlationId: string;
}): Promise<PublishResult> {
  const completed: PublishStep[] = [];
  const alreadyTrue: PublishStep[] = [];
  const refuse = (status: number, code: string, message: string): PublishResult =>
    ({ ok: false, status, code, message, completed, alreadyTrue });

  const identity = await getIdentity(admin, args.userId);
  if (!identity) return refuse(404, "NO_IDENTITY", "no identity has been issued for you yet");

  if (!identity.handle)
    return refuse(409, "NO_HANDLE",
      "claim your handle first -- publishing a discovery setting with no address gives a patient nothing to open");

  if (!DISCOVERY_MODES.some(m => m.key === args.discovery))
    return refuse(400, "VALIDATION_ERROR",
      `discovery must be one of: ${DISCOVERY_MODES.map(m => m.key).join(", ")}`);

  // ⚠ PUBLISHING TO HIDDEN IS NOT PUBLISHING. Refused rather than quietly accepted, because it would run
  // the lifecycle steps below and then leave the address shut -- and report success for both.
  if (args.discovery === "hidden")
    return refuse(400, "DISCOVERY_IS_HIDDEN",
      "hidden is where an identity starts and it publishes nothing. To go private again, change your discovery setting rather than publishing.");

  // ⚠ A PRACTITIONER DOES NOT LIFT THEIR OWN SUSPENSION. See NOT_SELF_PUBLISHABLE.
  if (NOT_SELF_PUBLISHABLE.has(identity.status))
    return refuse(409, "STATUS_NOT_SELF_SERVICE",
      `your identity is ${identity.status}, and that is not something this page can change. Nothing was published.`);

  const email = await authEmailConfirmation(admin, args.userId);
  if (email.state === "unreadable")
    return refuse(503, "EMAIL_UNREADABLE",
      `whether your sign-in email is confirmed could not be checked just now, so nothing was published: ${email.reason}`);
  if (email.state === "no_account")
    return refuse(409, "NO_AUTH_ACCOUNT", email.reason ?? "no sign-in account could be found for you");
  if (email.state === "unconfirmed")
    return refuse(409, "EMAIL_NOT_CONFIRMED", email.reason ?? EMAIL_UNCONFIRMED_NOTICE);
  completed.push("email_confirmed");

  let status: string = identity.status;

  if (status === "created") {
    const moved = await transitionIdentity(admin, {
      userId: args.userId, to: "email_verified", actorId: args.userId, correlationId: args.correlationId,
    });
    if (!moved.ok) return refuse(moved.status, moved.code, moved.message);
    status = moved.data.status;
    completed.push("email_verified");
  } else {
    alreadyTrue.push("email_verified");
  }

  if (!RESOLVABLE_STATES.has(status)) {
    const moved = await transitionIdentity(admin, {
      userId: args.userId, to: "active", actorId: args.userId, correlationId: args.correlationId,
    });
    if (!moved.ok) return refuse(moved.status, moved.code, moved.message);
    status = moved.data.status;
    completed.push("active");
  } else {
    // licence_verified already reaches the public, so it is left alone rather than stepped past: moving
    // it to active would discard a record of who checked, for nothing.
    alreadyTrue.push("active");
  }

  const updated = await updateIdentity(admin, {
    userId: args.userId, discovery: args.discovery, correlationId: args.correlationId,
  });
  if (!updated.ok) return refuse(updated.status, updated.code, updated.message);
  if (args.discovery === identity.discovery) alreadyTrue.push("discovery");
  else completed.push("discovery");

  // ⚠ ASKED, NOT ASSUMED. Four writes returning ok is not the same as a patient's browser arriving
  // somewhere, and this is the one function whose whole purpose is that it does.
  const check = await resolveHandle(admin, identity.handle);
  const address = check.kind === "found" ? "resolves"
    : check.kind === "unreadable" ? "unreadable" : "does_not_resolve";

  await audit(admin, {
    workspaceId: identity.primary_workspace_id, actorId: args.userId,
    eventType: "practice.identity_published",
    payload: {
      identityId: identity.id, handle: identity.handle, discovery: args.discovery,
      status, completed, address,
    },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      status, discovery: updated.data.discovery, bookingUrl: bookingUrl(identity.handle),
      completed, alreadyTrue, address,
      addressReason: address === "unreadable" && check.kind === "unreadable" ? check.reason
        : address === "does_not_resolve"
          ? "every step reported success and the address still does not open. Nothing further was changed."
          : null,
    },
  };
}

// ── RESOLUTION AND SEARCH ────────────────────────────────────────────────────────────────────────────

/** Only the fields s6 lists. Never the internal id, the user id or the workspace -- s13. */
function publicView(row: any) {
  return {
    practitionerNumber: row.practitioner_number,
    handle: row.handle,
    displayName: row.display_name,
    qualifications: row.qualifications,
    specialties: row.specialties,
    subSpecialty: row.sub_specialty,
    biography: row.biography,
    languages: row.languages,
    consultationTypes: row.consultation_types,
    // s4's optional photograph. The PATH, not a URL: composing the address is practitioner-photo.ts's
    // job and there must be exactly one place that does it. Null until migration 362 is applied and a
    // practitioner uploads one, and the initials avatar is what renders in the meantime.
    photoPath: row.photo_path ?? null,
    // ⚠ NO LICENCE FIELD REACHES THIS VIEW, AND CPR-BOOK-PROFILE-001 s4 DID NOT CHANGE THAT.
    //
    // That spec permits a "Verified practitioner" indicator "only if CP has a canonical verification
    // state that justifies the claim", and this codebase had already answered the second half of that
    // sentence: NOT_BUILT's licence_verification entry says the licence_verified state is "a provenance
    // record rather than a verification. Nothing here contacts a council." A blue tick beside a real
    // clinician's name tells a patient a regulator was checked. Nothing here has ever checked one.
    //
    // So the projection stays as it was, the badge is not rendered, and turning it on is an owner
    // decision that needs a real verification behind it rather than a UI change.
    // practice-booking-link-harness 5b-tick is the assertion that holds this line -- it went red the
    // moment this field was added, which is how the conflict was found rather than shipped.
    discovery: row.discovery,
    bookingUrl: row.handle ? bookingUrl(row.handle) : null,
    // WHETHER BOOKING IS OPEN, and why not when it is not. s7's modes differ in exactly this.
    bookingOpen: row.discovery === "public" || row.discovery === "link_only",
    bookingNote:
      row.discovery === "existing_patients" ? "Bookings here are for people already registered with this practice."
      : row.discovery === "referral_only" ? "New bookings come by referral."
      : null,
  };
}

/**
 * Resolve a handle for the public page (s8, s11).
 *
 * A HIDDEN IDENTITY IS A 404, NOT A REFUSAL. "This practitioner exists but will not see you" is a
 * disclosure about a named person; nothing distinguishes it from a handle that was never issued.
 * Returns the REDIRECT when the handle is a retired one, which is what s8's automatic redirect is.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ A FAILED READ IS `unreadable`, AND IT USED TO BE `none`.
 *
 * All three queries below destructured only `data`, so a database that could not answer produced a
 * confident "there is no such practitioner" -- a 404 for a real, live, published clinician whose patient
 * was holding a printed card. It is the same defect handleAvailable() carries a warning about, in the
 * function that decides whether a printed address opens at all.
 *
 * It matters twice over now that identitySetupView asks THIS FUNCTION whether a handle resolves before
 * it offers a QR code and a print button: reporting a broken read as "does not resolve" is merely
 * unhelpful, but reporting it as "resolves" would have been the sharing defect all over again. Three
 * states, so neither caller has to guess.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export async function resolveHandle(admin: any, rawHandle: string): Promise<
  | { kind: "found"; profile: ReturnType<typeof publicView> }
  | { kind: "redirect"; to: string }
  | { kind: "none" }
  | { kind: "unreadable"; reason: string }
> {
  const h = normaliseHandle(rawHandle);
  if (!HANDLE_RE.test(h)) return { kind: "none" };

  const { data: row, error } = await admin.from("practice_practitioner_identity")
    .select("*").eq("handle", h).maybeSingle();
  if (error) return { kind: "unreadable", reason: error.message };

  if (row) {
    if (row.discovery === "hidden") return { kind: "none" };
    if (!RESOLVABLE_STATES.has(row.status)) return { kind: "none" };
    return { kind: "found", profile: publicView(row) };
  }

  // ⚠ CPB-002's "Old links always redirect", AND IT IS A REDIRECT RATHER THAN A RESERVATION.
  //
  // practice_handle_history does two separate jobs and it is worth naming both, because only one of them
  // is visible from handleAvailable(): it RESERVES the old name so nobody else can ever claim it, and it
  // POINTS at the identity that used to hold it so an old link still arrives somewhere. Reservation alone
  // would mean a printed poster reached a dead page instead of a stranger -- better, and still a patient
  // who cannot reach their practitioner. This is the half that makes the poster work.
  //
  // ⚠ AND THE TARGET IS COMPOSED FROM bookingPath, not typed. It used to read `/@${handle}`, which was
  // the route before CPB-002 moved it; a redirect that points at a route this application no longer
  // serves is a 404 wearing a 307.
  const { data: retired, error: retiredError } = await admin.from("practice_handle_history")
    .select("identity_id").eq("handle", h).maybeSingle();
  if (retiredError) return { kind: "unreadable", reason: retiredError.message };
  if (retired) {
    const { data: current, error: currentError } = await admin.from("practice_practitioner_identity")
      .select("handle, discovery, status").eq("id", retired.identity_id).maybeSingle();
    if (currentError) return { kind: "unreadable", reason: currentError.message };
    if (current?.handle && current.discovery !== "hidden" && RESOLVABLE_STATES.has(current.status))
      return { kind: "redirect", to: bookingPath(current.handle) };
  }
  return { kind: "none" };
}

/**
 * s9's search resolution, in its exact priority order:
 *   Exact Handle -> Practitioner Number -> Exact Display Name -> Surname -> Specialty -> Fuzzy Match
 *
 * s7: ONLY PUBLIC IDENTITIES ARE SEARCHABLE. That filter is applied in every query below rather than to
 * the merged result -- filtering afterwards is the classic search leak, where a total discloses that a
 * hidden practitioner exists. Same position CPR-350 took.
 */
export async function searchPractitioners(admin: any, rawQuery: string, limit = 20) {
  const q = rawQuery.trim();
  if (q.length < 2) return { tier: null, results: [] as ReturnType<typeof publicView>[] };

  const listed = (builder: any) => builder.eq("discovery", "public").in("status", [...RESOLVABLE_STATES]);
  const base = () => listed(admin.from("practice_practitioner_identity").select("*"));
  const seen = new Set<string>();
  const out: any[] = [];
  const take = (rows: any[] | null) => {
    for (const r of rows ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id); out.push(r);
    }
  };

  const handle = normaliseHandle(q);
  // THE NUMBER IS PARSED, NOT COMPARED AS TYPED. A patient reading one off a card types spaces, lower
  // case or no separators, and none of that changes who they meant -- but a transposed pair does, and
  // the check digit refuses it here rather than letting it resolve to a different real clinician.
  const format = await getFormat(admin);
  const parsedNumber = parsePractitionerNumber(q, format);

  const tiers: { tier: string; run: () => Promise<any> }[] = [
    { tier: "handle", run: () => base().eq("handle", handle).limit(limit) },
    {
      tier: "number",
      run: () => parsedNumber.ok
        ? base().eq("practitioner_number", parsedNumber.normalised).limit(limit)
        : Promise.resolve({ data: [] }),
    },
    { tier: "display_name", run: () => base().ilike("display_name", q).limit(limit) },
    { tier: "surname", run: () => base().ilike("display_name", `% ${q}`).limit(limit) },
    { tier: "specialty", run: () => base().ilike("specialties", `%${q}%`).limit(limit) },
    { tier: "fuzzy", run: () => base().ilike("display_name", `%${q}%`).limit(limit) },
  ];

  let matchedTier: string | null = null;
  for (const t of tiers) {
    const { data } = await t.run();
    if ((data ?? []).length > 0) {
      // THE TIER THAT FIRST MATCHED IS REPORTED, so a caller can tell an exact hit from a fuzzy one --
      // which is the whole point of a priority order.
      if (!matchedTier) matchedTier = t.tier;
      take(data);
      if (matchedTier === "handle" || matchedTier === "number") break;
    }
  }
  return { tier: matchedTier, results: out.slice(0, limit).map(publicView) };
}

// ── THE SHARING TOOLKIT (s12) ────────────────────────────────────────────────────────────────────────

/**
 * QR codes, generated in process.
 *
 * NO EXTERNAL SERVICE. A QR code is a deterministic encoding of a string; fetching one from an image API
 * would send every practitioner's booking URL to a third party and make a printed card depend on
 * somebody else's uptime.
 */
export async function bookingQr(handle: string, format: "svg" | "png" = "svg"): Promise<string> {
  const url = bookingUrl(handle);
  return format === "svg"
    ? QRCode.toString(url, { type: "svg", margin: 1, width: 320, errorCorrectionLevel: "M" })
    : QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
}

/**
 * s12's message templates.
 *
 * TEMPLATES, NOT MESSAGES. This product sends nothing -- CPR-320 and CPR-340 settled that and their
 * harnesses enforce it structurally. What it can honestly do is write the text for a practitioner to
 * paste into WhatsApp themselves, which is what a "sharing toolkit" is when there is no channel.
 */
export function shareTemplates(displayName: string, handle: string) {
  const url = bookingUrl(handle);
  return {
    sentByThisProduct: false,
    templates: [
      { key: "whatsapp", label: "WhatsApp", body: `Hello, this is ${displayName}. You can book an appointment with me here: ${url}` },
      { key: "sms", label: "SMS", body: `${displayName} -- book an appointment: ${url}` },
      { key: "email", label: "Email", subject: `Booking with ${displayName}`, body: `Hello,\n\nYou can book an appointment with me using the link below.\n\n${url}\n\n${displayName}` },
      { key: "card", label: "Printed card", body: `${displayName}\n@${handle}\n${url}` },
    ],
  };
}

/**
 * CPB-002's "Quick Share" row: WhatsApp, Email, SMS, Facebook, LinkedIn, copy link, embed.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THESE ARE LINKS A PRACTITIONER CLICKS, NOT INTEGRATIONS. Nothing here has an API key, an OAuth
 * grant or a webhook, and nothing is posted on anybody's behalf. Each `href` is a URL that opens the
 * other application with the message already typed; the practitioner presses send. That is the whole
 * honest version of "share tools working" when this product has no outbound channel of its own, and it
 * is worth the distinction: a button labelled "Share on Facebook" that posted for you would need an
 * app review, a page token and a permission the practitioner never granted.
 *
 * ⚠ AND THE TWO SOCIAL ONES SEND THE LINK TO A THIRD PARTY WHEN THEY ARE CLICKED. Facebook and LinkedIn
 * receive the booking URL -- which is a public address by design, and is the practitioner's own to
 * publish -- but nothing on this page contacts either company until somebody clicks. There is no pixel,
 * no script and no preconnect, so a practitioner who never clicks is never seen by them.
 *
 * ⚠ EVERY TARGET IS BUILT FROM bookingUrl(). One construction, so the thing shared, the thing shown and
 * the thing encoded into the QR are the same string.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export type ShareTarget = {
  key: string;
  label: string;
  /** What this actually does, in the practitioner's words. Never "shares to X" when it opens X. */
  detail: string;
  /** The link to open. Null for `copy`, which is the URL itself and opens nothing. */
  href: string | null;
  /** ⚠ TRUE when clicking hands the booking URL to somebody other than the practitioner and the patient. */
  leavesCompeten: boolean;
};

export function shareTargets(displayName: string, handle: string): {
  url: string;
  targets: ShareTarget[];
  /** ⚠ NOTHING HERE SENDS ANYTHING. Stated as a field so a screen cannot imply otherwise. */
  sentByThisProduct: false;
} {
  const url = bookingUrl(handle);
  const message = `Hello, this is ${displayName}. You can book an appointment with me here: ${url}`;
  const e = encodeURIComponent;

  return {
    url,
    sentByThisProduct: false,
    targets: [
      {
        key: "copy", label: "Copy link", detail: "Copies the address to your clipboard. Nothing is sent.",
        href: null, leavesCompeten: false,
      },
      {
        key: "whatsapp", label: "WhatsApp",
        detail: "Opens WhatsApp with the message written. You choose who to send it to and press send.",
        href: `https://wa.me/?text=${e(message)}`, leavesCompeten: true,
      },
      {
        key: "sms", label: "SMS",
        detail: "Opens your phone's messages with the text written. You choose the number and press send.",
        // RFC 5724's body parameter. Handsets differ on `?` versus `&`; `?body=` is the form both
        // iOS and Android have accepted since iOS 8, and a mis-parsed one opens an empty message
        // rather than sending a wrong one.
        href: `sms:?body=${e(message)}`, leavesCompeten: false,
      },
      {
        key: "email", label: "Email",
        detail: "Opens your mail programme with the subject and message written. You choose the recipient.",
        href: `mailto:?subject=${e(`Booking with ${displayName}`)}&body=${e(message)}`, leavesCompeten: false,
      },
      {
        key: "facebook", label: "Facebook",
        detail: "Opens Facebook's own share window with your booking address. Facebook receives the address when you click.",
        href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`, leavesCompeten: true,
      },
      {
        key: "linkedin", label: "LinkedIn",
        detail: "Opens LinkedIn's own share window with your booking address. LinkedIn receives the address when you click.",
        href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`, leavesCompeten: true,
      },
    ],
  };
}

/**
 * CPB-002's "Website embed".
 *
 * ⚠ A LINK, NOT A WIDGET, AND NOT AN IFRAME. A script embed would run this product's code inside
 * somebody else's site, which is a supply chain the practitioner cannot audit and this product cannot
 * update safely; an iframe would put a booking form -- and eventually a patient's name and date of birth
 * -- inside a page whose framing, storage and third-party scripts are outside our control. An anchor
 * does the job the practitioner actually asked for, works with JavaScript switched off, and cannot leak
 * anything, because it carries nothing.
 */
export function embedSnippet(displayName: string, handle: string): string {
  const url = bookingUrl(handle);
  const safe = displayName.replace(/[<>&"]/g, c =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
  return `<a href="${url}" rel="noopener">Book an appointment with ${safe}</a>`;
}
