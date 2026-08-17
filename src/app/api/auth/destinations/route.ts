import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { resolveProductDestinations } from "@/lib/identity/product-resolution";

// COMP-ID-ROUTE-001 s8/s9 -- the neutral resolver's HTTP door, for the just-signed-in login page.
//
// ⚠ THE CALLER'S OWN SESSION, NEVER A CLIENT-SUPPLIED USER. The login page calls this with no
// arguments the moment authentication succeeds; the user is read from the authenticated session
// cookie, and the destination set from trusted tables (s8). There is nothing here to tamper with:
// a fabricated request without a session gets 401, and a session gets only its own destinations.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const resolution = await resolveProductDestinations(createAdminClient(), user.id);
  return NextResponse.json(resolution);
}
