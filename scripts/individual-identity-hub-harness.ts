/**
 * INDIVIDUAL IDENTITY HUB HARNESS -- COMPETEN-INDIVIDUAL-IDENTITY-HUB-01 (migration 590). Reads source only. No database.
 *
 *   I1  the photo is PRIVATE: its own private bucket, never the estate's public avatars bucket or a public URL;
 *       every upload is sniffed from its bytes and stripped of metadata BEFORE it is stored.
 *   I2  the photo reaches someone else only on a Passport link the person ticked it for: /verify and the previews
 *       ask for it only when the view's include_photo is true, and the owner's photo route serves only the caller.
 *   I3  the identity routes are guarded, write only the four allowlisted fields, and audit field names, not values.
 *   I4  private by default: the profile never prints a registration number, and /verify reads nothing of the
 *       identity but the photo, and that only per I2.
 *   I5  one record, one home (HFE D2): registrations are not added from the profile; the shared record route
 *       refuses any kind the experience does not own here.
 *   I6  before 590 nothing breaks: the view's other fields are read apart from include_photo, and a link writes
 *       include_photo only when it is chosen.
 *
 * Every check is proven able to fail: section X plants one violation per check, in memory, and expects RED.
 *
 *   npx tsx scripts/individual-identity-hub-harness.ts
 */
import { readFileSync, existsSync } from "node:fs";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
type R = { ok: boolean; detail: string };
type Sources = Map<string, string>;
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const IDENTITY = "src/lib/individual/identity.ts", META = "src/lib/individual/image-metadata.ts", HUB = "src/lib/individual/profile-hub.ts";
const R_ID = "src/app/api/individual/identity/route.ts", R_PHOTO = "src/app/api/individual/identity/photo/route.ts";
const PAGE = "src/app/individual/(app)/[experience]/profile/page.tsx", PHOTO_UI = "src/app/individual/_components/profile/PhotoControl.tsx";
const VERIFY = "src/app/verify/[token]/page.tsx", VIEW = "src/lib/individual/passport-view.ts", SHARE = "src/lib/individual/professional/share.ts";
const FORM = "src/lib/individual/professional/share-passport.ts", ITEMS = "src/app/api/individual/profile-items/route.ts";
const PREVIEWS = ["src/app/individual/(app)/[experience]/(professional)/share/preview/page.tsx", "src/app/individual/(app)/[experience]/passport/share/preview/page.tsx"];
const FILES = [IDENTITY, META, HUB, R_ID, R_PHOTO, PAGE, PHOTO_UI, VERIFY, VIEW, SHARE, FORM, ITEMS, ...PREVIEWS];
const ALL: Sources = new Map(FILES.map(f => [f, existsSync(f) ? strip(readFileSync(f, "utf8")).replace(/\r\n/g, "\n") : ""]));
const MIG_FILE = "supabase/migrations/590-individual-identity-hub.sql";
const MIG = existsSync(MIG_FILE) ? readFileSync(MIG_FILE, "utf8").replace(/--.*$/gm, "").replace(/\r\n/g, "\n") : "";
const g = (src: Sources, f: string) => src.get(f) ?? "";

// ── I1 ──
const checkPrivatePhoto = (src: Sources, mig: string): R => {
  const id = g(src, IDENTITY);
  const own = /export const PHOTO_BUCKET = "individual-photos";/.test(id)
    && !/\bavatars\b|getPublicUrl|avatar_url/.test([IDENTITY, R_ID, R_PHOTO, PAGE, PHOTO_UI].map(f => g(src, f)).join("\n"));
  const store = id.slice(id.indexOf("export async function storePhoto"), id.indexOf("export async function removePhoto"));
  const order = store.indexOf("sniffImage(raw)") > -1 && store.indexOf("sniffImage(raw)") < store.indexOf("stripImageMetadata(raw, mime)")
    && store.indexOf("stripImageMetadata(raw, mime)") < store.indexOf(".upload(") && /\.upload\(path, Buffer\.from\(clean\)/.test(store)
    && /const path = `\$\{userId\}\/photo-/.test(store);
  const routed = /const out = await storePhoto\(ctx\.admin, ctx\.userId, file,/.test(g(src, R_PHOTO)) && !/\.upload\(/.test(g(src, R_PHOTO));
  const bucket = !mig || /values \('individual-photos', 'individual-photos', false, 5242880/.test(mig);
  return { ok: own && order && routed && bucket, detail: `own private bucket, no public URL ${own}, sniffed then stripped then stored under the person ${order}, the route only via storePhoto ${routed}, bucket private in 590 ${bucket}` };
};

// ── I2 ──
const checkPhotoPerLink = (src: Sources): R => {
  const verify = g(src, VERIFY);
  const onVerify = /const photo = meta\.includePhoto \? await photoUrl\(admin, identityOf\(await loadIdentity\(admin, share\.nurse_id\)\)\.photoPath\) : null;/.test(verify)
    && (verify.match(/photoUrl\(/g) ?? []).length === 1;
  const previews = PREVIEWS.every(f => /const photo = selection\.meta\?\.includePhoto \? await photoUrl\(ctx\.admin, identityOf\(await loadIdentity\(ctx\.admin, ctx\.userId\)\)\.photoPath\) : null;/.test(g(src, f)));
  const meta = /includePhoto: !photo\.error && photo\.data\?\.include_photo === true/.test(g(src, VIEW));
  const ticked = /const includePhoto = ticked\(b\.includePhoto\);/.test(g(src, FORM));
  const r = g(src, R_PHOTO), get = r.slice(r.indexOf("export async function GET"), r.indexOf("export async function POST"));
  const ownOnly = /loadIdentity\(ctx\.admin, ctx\.userId\)/.test(get) && !/searchParams|params|userId\s*=\s*(body|fields|url)/.test(get);
  return { ok: onVerify && previews && meta && ticked && ownOnly, detail: `/verify only when the view chose it ${onVerify}, previews likewise ${previews}, the choice read strictly ${meta}, only when ticked ${ticked}, own photo route serves only the caller ${ownOnly}` };
};

// ── I3 ──
const checkRoutes = (src: Sources): R => {
  const guarded = [R_ID, R_PHOTO].every(f => {
    const s = g(src, f);
    const handlers = [...s.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].length;
    return handlers > 0 && [...s.matchAll(/const ctx = await requireIndividualContext\(\);\n\s*if \(isGuardRefusal\(ctx\)\) return ctx;/g)].length === handlers;
  });
  const id = g(src, IDENTITY);
  const allow = /export const IDENTITY_FIELDS = \{ preferred_name: 80, headline: 140, location: 120, biography: 2000 \} as const;/.test(id)
    && /for \(const key of Object\.keys\(IDENTITY_FIELDS\) as IdentityField\[\]\)/.test(id) && /const parsed = parseIdentityPatch\(/.test(g(src, R_ID));
  const audit = /fields: Object\.keys\(parsed\.patch\)/.test(g(src, R_ID)) && !/parsed\.patch\)\s*\}/.test(g(src, R_ID).replace(/Object\.keys\(parsed\.patch\)/g, ""));
  return { ok: guarded && allow && audit, detail: `every handler guarded ${guarded}, four allowlisted fields ${allow}, audit names fields only ${audit}` };
};

// ── I4 ──
const checkPrivateByDefault = (src: Sources): R => {
  const page = g(src, PAGE);
  // The number is mentioned once, only to say one is recorded: never rendered.
  const noNumber = (page.match(/self_declared_registration_number/g) ?? []).length === 1
    && /primary\?\.self_declared_registration_number \? <span className="text-gray-600">Recorded, private<\/span> : null/.test(page);
  const verify = g(src, VERIFY);
  const verifyBlind = !/\.(headline|biography|location|preferredName)\b|individual_identity_profile/.test(verify);
  return { ok: noNumber && verifyBlind, detail: `profile never prints a registration number ${noNumber}, /verify reads nothing of the identity but the chosen photo ${verifyBlind}` };
};

// ── I5 ──
const checkHomes = (src: Sources): R => {
  const hub = g(src, HUB);
  const kinds = /professional: \["qualification", "employment", "specialty", "interest", "aspiration", "skill"\],/.test(hub) && !/scholar: \[[^\]]*"registration"/.test(hub);
  const route = /if \(!kindAllowed\(experience, fields\.kind\)\) return refuse/.test(g(src, ITEMS));
  const link = /Add or change in My practice/.test(g(src, PAGE));
  return { ok: kinds && route && link, detail: `registrations not added here ${kinds}, the route refuses other kinds ${route}, registration card points to My practice ${link}` };
};

// ── I6 ──
const checkBefore590 = (src: Sources): R => {
  const view = g(src, VIEW);
  const apart = /select\("share_token_id, purpose_label, recipient_label, summary, include_institution, activated_at"\)/.test(view)
    && /\.select\("include_photo"\)/.test(view);
  const onlyChosen = /\.\.\.\(view\.includePhoto \? \{ include_photo: true \} : \{\}\)/.test(g(src, SHARE));
  return { ok: apart && onlyChosen, detail: `view read apart from include_photo ${apart}, include_photo written only when chosen ${onlyChosen}` };
};

function main() {
  console.log("INDIVIDUAL IDENTITY HUB HARNESS (590)\n");
  const run = (name: string, r: R) => ok(name, r.ok, r.detail);
  run("I1. the photo is private: its own bucket, never public, sniffed and stripped before it is stored", checkPrivatePhoto(ALL, MIG));
  run("I2. the photo reaches others only on a link it is ticked for; the owner's route serves only the caller", checkPhotoPerLink(ALL));
  run("I3. identity routes guarded, four allowlisted fields, audit names fields only", checkRoutes(ALL));
  run("I4. private by default: no registration number printed, /verify reads nothing else of the identity", checkPrivateByDefault(ALL));
  run("I5. one record, one home: registrations stay in My practice", checkHomes(ALL));
  run("I6. before 590 nothing breaks: include_photo read apart and written only when chosen", checkBefore590(ALL));

  const plant = (f: string, from: string, to: string) => { const m = new Map(ALL); m.set(f, (m.get(f) ?? "").replace(from, to)); return m; };
  const add = (f: string, code: string) => { const m = new Map(ALL); m.set(f, `${m.get(f) ?? ""}\n${code}`); return m; };
  const red = (name: string, r: R) => ok(`X. ${name} goes RED`, !r.ok, "the control did not fail");
  red("I1 on the public avatars bucket", checkPrivatePhoto(plant(IDENTITY, 'export const PHOTO_BUCKET = "individual-photos";', 'export const PHOTO_BUCKET = "avatars";'), MIG));
  red("I1 on a photo stored before stripping", checkPrivatePhoto(plant(IDENTITY, ".upload(path, Buffer.from(clean)", ".upload(path, Buffer.from(raw)"), MIG));
  red("I1 on a public URL", checkPrivatePhoto(add(R_PHOTO, 'const u = admin.storage.from("individual-photos").getPublicUrl(p);'), MIG));
  red("I1 on a public bucket in 590", checkPrivatePhoto(ALL, MIG.replace("'individual-photos', 'individual-photos', false,", "'individual-photos', 'individual-photos', true,")));
  red("I2 on /verify showing the photo on every link", checkPhotoPerLink(plant(VERIFY, "const photo = meta.includePhoto ? await photoUrl(", "const photo = true ? await photoUrl(")));
  red("I2 on a view that assumes the photo", checkPhotoPerLink(plant(VIEW, "includePhoto: !photo.error && photo.data?.include_photo === true", "includePhoto: !photo.error")));
  red("I2 on the photo route serving any person", checkPhotoPerLink(plant(R_PHOTO, "loadIdentity(ctx.admin, ctx.userId)).photoPath);\n  if (!url)", "loadIdentity(ctx.admin, new URL(req.url).searchParams.get(\"u\")!)).photoPath);\n  if (!url)")));
  red("I3 on an unguarded handler", checkRoutes(plant(R_ID, "const ctx = await requireIndividualContext();\n  if (isGuardRefusal(ctx)) return ctx;", "const ctx = await requireIndividualContext();")));
  red("I3 on audited values", checkRoutes(plant(R_ID, "fields: Object.keys(parsed.patch)", "fields: parsed.patch")));
  red("I4 on a registration number printed", checkPrivateByDefault(plant(PAGE, '<span className="text-gray-600">Recorded, private</span>', "{primary.self_declared_registration_number}")));
  red("I4 on /verify reading the biography", checkPrivateByDefault(add(VERIFY, "const bio = identityOf(x).biography;")));
  red("I5 on registrations added from the profile", checkHomes(plant(HUB, 'professional: ["qualification", "employment",', 'professional: ["qualification", "registration", "employment",')));
  red("I6 on include_photo read with the rest of the view", checkBefore590(plant(VIEW, 'select("share_token_id, purpose_label, recipient_label, summary, include_institution, activated_at")', 'select("share_token_id, purpose_label, recipient_label, summary, include_institution, activated_at, include_photo")')));
  red("I6 on include_photo always written", checkBefore590(plant(SHARE, "...(view.includePhoto ? { include_photo: true } : {})", "include_photo: !!view.includePhoto")));

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}
main();
