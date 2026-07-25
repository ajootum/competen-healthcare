import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

// PW-012 Preferences — persistence for personal configuration. No user_preferences table exists yet, so
// preferences are stored in a per-browser cookie (pw_prefs). This is genuinely persistent (survives reloads and
// sessions on this device) and honest about its scope: cross-device sync requires a server-side store (progressive).
// Whitelisted keys/values only; own-session (any authenticated user stores their own browser prefs).
/* eslint-disable @typescript-eslint/no-explicit-any */
export const COOKIE = "pw_prefs";
const ALLOWED: Record<string, (v: any) => boolean> = {
  theme: v => ["light", "dark", "system"].includes(v),
  density: v => ["standard", "compact", "spacious"].includes(v),
  landing: v => typeof v === "string" && v.length <= 40,
  emailDigest: v => ["daily", "weekly", "none"].includes(v),
  notifyTasks: v => typeof v === "boolean",
  notifyLearning: v => typeof v === "boolean",
  notifySystem: v => typeof v === "boolean",
  reducedMotion: v => typeof v === "boolean",
  timezone: v => typeof v === "string" && v.length <= 60,
  notes: v => typeof v === "string" && v.length <= 500,
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const store = await cookies();
  let prefs: any = {};
  try { prefs = JSON.parse(store.get(COOKIE)?.value ?? "{}"); } catch { prefs = {}; }
  return NextResponse.json({ prefs });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const store = await cookies();
  let current: any = {};
  try { current = JSON.parse(store.get(COOKIE)?.value ?? "{}"); } catch { current = {}; }

  // Reset support.
  if (body.__reset === true) {
    const res = NextResponse.json({ ok: true, prefs: {} });
    res.cookies.set(COOKIE, "{}", { path: "/", maxAge: 0 });
    return res;
  }

  const next = { ...current };
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED[k] && ALLOWED[k](v)) next[k] = v;
  }
  const res = NextResponse.json({ ok: true, prefs: next });
  res.cookies.set(COOKIE, JSON.stringify(next), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}
