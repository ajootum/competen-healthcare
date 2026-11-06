/* eslint-disable @typescript-eslint/no-explicit-any */
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { READER_ZONE_COOKIE, resolveReaderClock, type ReaderClock } from "@/lib/datetime";
import { loadIndividualPolicyOnce } from "@/lib/individual/policy";

// SERVER-ONLY. The reader's clock for this request. Design: docs/design/LOCAL-TIME-ZONES.md.
//
// Null while policy scholar_reader_time_zone is off, so the off state reads no preference and no cookie, and every
// call site keeps what it showed before. Any failure is also null: a time shown as before, never a broken page.
//
// user_preferences.timezone holds only what the person chose. The device's zone stays in its own cookie and is
// never saved here: see the design note for why.

async function chosenZone(admin: any, userId: string): Promise<string | null> {
  const { data, error } = await admin.from("user_preferences").select("timezone").eq("user_id", userId).maybeSingle();
  return error ? null : data?.timezone ?? null;
}

async function load(admin: any, userId: string): Promise<ReaderClock | null> {
  try {
    const policy = await loadIndividualPolicyOnce(admin);
    if (policy.scholarReaderTimeZone !== "on") return null;
    const [jar, hdrs, choice] = await Promise.all([cookies(), headers(), chosenZone(admin, userId).catch(() => null)]);
    return resolveReaderClock({ choice, device: jar.get(READER_ZONE_COOKIE)?.value, network: hdrs.get("x-vercel-ip-timezone") });
  } catch {
    return null;
  }
}

const loadOnce = cache(load);

/** Once per request, however many pages and layouts ask. */
export const readerClock = (ctx: { admin: any; userId: string }): Promise<ReaderClock | null> => loadOnce(ctx.admin, ctx.userId);
