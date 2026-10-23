import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isNotProvisioned } from "@/lib/individual/access";
import { parsePrefs } from "@/lib/individual/professional/preferences";
import { ORIGIN } from "@/lib/individual/professional/vocabulary";
import { audit, readBody, refuse, writeFailed } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// PUT /api/individual/professional/reminders -- COMPETEN-IND-007, migration 374 (owner GO, Option A).
//
// The person's two reminder switches, in-app and email, set together and independently of each other.
// They are written to the person's own professional record, never to the estate notification_preferences.
// A person who has not recorded a profession yet still gets a row: an empty profile with only the
// switches set is not a registration (record.ts hasProfile), so nothing appears in their Passport.

export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const prefs = parsePrefs(fields);
  if (!prefs) return refuse("Choose whether to get in-app reminders and email reminders.");

  const { data: existing, error: readErr } = await ctx.admin.from("individual_professional_profile")
    .select("id").eq("user_id", ctx.userId).maybeSingle();
  if (readErr) return writeFailed("reminder settings");

  const { error } = existing
    ? await ctx.admin.from("individual_professional_profile")
      .update({ ...prefs, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("user_id", ctx.userId)
    : await ctx.admin.from("individual_professional_profile")
      .insert({ ...prefs, user_id: ctx.userId, experience_code: ORIGIN });
  if (error) {
    // The columns arrive with migration 374. Without them the switches cannot be stored, and the page
    // does not offer them (preferences.ts configurable: false). Say so rather than "try again".
    if (isNotProvisioned(error)) return refuse("Reminder settings are not available on this environment yet.", 409);
    return writeFailed("reminder settings");
  }

  await audit(ctx, "individual_professional_reminder_preferences", "individual_professional_profile", existing?.id ?? null, prefs);
  return NextResponse.json({ ok: true, ...prefs });
}
