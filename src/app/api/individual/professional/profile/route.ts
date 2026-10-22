import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { parseProfile } from "@/lib/individual/professional/validate";
import { ORIGIN } from "@/lib/individual/professional/vocabulary";
import { audit, readBody, refuse, writeFailed } from "@/lib/individual/professional/api";

// PUT /api/individual/professional/profile -- COMPETEN-IND-007 s1, owner ruling D5.
//
// The person's own professional identity record (migration 373 individual_professional_profile). Every
// field is self-declared, and its column name says so (migration 270's vocabulary). Nothing here contacts
// a regulator, and nothing here can mark the registration checked: there is no column for it.
//
// ⚠ THE REMINDER MARK FOLLOWS THE DATE. registration_reminded_for may only equal the expiry it was sent
// for (373's CHECK). A new expiry date clears it, so the new date is reminded once.

export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const parsed = parseProfile(fields);
  if (!parsed.ok) return refuse(parsed.error);

  const { data: existing, error: readErr } = await ctx.admin.from("individual_professional_profile")
    .select("id, registration_reminded_for").eq("user_id", ctx.userId).maybeSingle();
  if (readErr) return writeFailed("profile");

  const now = new Date().toISOString();
  const keepMark = existing?.registration_reminded_for && existing.registration_reminded_for === parsed.value.self_declared_registration_expires_on;
  const { error } = existing
    ? await ctx.admin.from("individual_professional_profile")
      .update({ ...parsed.value, registration_reminded_for: keepMark ? existing.registration_reminded_for : null, updated_at: now })
      .eq("id", existing.id).eq("user_id", ctx.userId)
    : await ctx.admin.from("individual_professional_profile")
      .insert({ ...parsed.value, user_id: ctx.userId, experience_code: ORIGIN });
  if (error) return writeFailed("profile");

  await audit(ctx, existing ? "individual_professional_profile_update" : "individual_professional_profile_create", "individual_professional_profile", existing?.id ?? null);
  return NextResponse.json({ ok: true });
}
