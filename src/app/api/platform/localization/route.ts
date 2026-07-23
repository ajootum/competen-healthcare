import { NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { localizationCatalogue, localeBundle } from "@/lib/platform/localization";

// Localization Resource Service API (PFS-000 Localization). GET → the locale catalogue
// with per-locale coverage; GET ?locale=<code> → the full resolved resource bundle for
// that locale (every base key, translated or fallen back to base). Any authenticated
// caller — i18n bundles are app-wide resources, not tenant-sensitive.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;

  const locale = new URL(req.url).searchParams.get("locale");
  if (locale) return NextResponse.json(localeBundle(locale), { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(localizationCatalogue(), { headers: { "Cache-Control": "no-store" } });
}
