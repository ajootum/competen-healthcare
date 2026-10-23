import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

import { currentTraceId } from "@/lib/trace";
import { NAME_FIELDS, namesUnsupported, parseProfilePatch, readOwnAccess, readOwnProfile } from "@/lib/account/own-profile";

// Request-time only: it reads the session.
export const dynamic = "force-dynamic";

// /api/account/profile -- the ONE own-profile endpoint (owner GO 2026-10-23, PR D, src/lib/account/own-profile.ts).
//
// GET    the caller's own profile and a read-only view of their access.
// PATCH  the caller's own personal fields: full_name, phone, country, specialization, and (migration 380)
//        given_name and family_name. Nothing else, ever.
//
// ⚠ THE WRITE GOES THROUGH THE CALLER'S OWN SESSION, NOT THE SERVICE ROLE. It used to use the admin client,
// which bypasses RLS, so the only thing standing between a self-update and an authority column was this
// file's allowlist. Through the session, the database's column grants (personal columns only) and the
// "Users update own profile" WITH CHECK profile_authority_unchanged(...) apply as well.
//
// ⚠ EMAIL IS NOT A FIELD HERE. It changes through Supabase's verified email-change flow
// (supabase.auth.updateUser({ email }) in the browser), and this route never writes profiles.email.

async function sessionUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await sessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [profile, access] = await Promise.all([
    readOwnProfile(supabase, user),
    readOwnAccess(createAdminClient(), user.id),
  ]);
  return NextResponse.json({ profile, access });
}

export async function PATCH(req: Request) {
  const { supabase, user } = await sessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = parseProfilePatch(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const update = parsed.patch;

  const { data, error } = await supabase.from("profiles").update(update).eq("id", user.id).select("id");
  if (error) {
    if (NAME_FIELDS.some(f => f in update) && namesUnsupported(error))
      return NextResponse.json({ error: "Given and family names are not available on this environment yet. Nothing was changed." }, { status: 409 });
    return NextResponse.json({ error: "Your profile could not be saved. Nothing was changed." }, { status: 400 });
  }
  if (!data?.length) return NextResponse.json({ error: "Your profile could not be saved. Nothing was changed." }, { status: 400 });

  const admin = createAdminClient();
  await admin.from("audit_log").insert({ trace_id: await currentTraceId(),
    actor_id: user.id, actor_name: update.full_name ?? null,
    action: "update_profile", entity_type: "profile", entity_id: user.id,
    // Field names only -- never the values, which are personal data.
    entity_name: Object.keys(update).join(", "),
  });
  return NextResponse.json({ ok: true });
}
