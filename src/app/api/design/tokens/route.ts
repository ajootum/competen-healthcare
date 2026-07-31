import { NextResponse } from "next/server";
import { tokensJson, cssVariables } from "@/lib/design/tokens";

// PUI-001 s10: "Design tokens ... available as JSON for system use."
//
// Public and unauthenticated ON PURPOSE: these are the platform's published visual constants — hex values,
// type scale, spacing steps — and carry no tenant or patient data. Anything that needs the design language
// (a tenant theming tool, a design-system doc site, a native client) reads the SAME values the app renders
// with, so no consumer has to hard-code a second copy.
//
// `?format=css` returns the custom-property block for consumers that would rather import CSS than map JSON.

export const dynamic = "force-static";

export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format");

  if (format === "css") {
    const body = [":root {", ...Object.entries(cssVariables()).map(([k, v]) => `  ${k}: ${v};`), "}"].join("\n");
    return new NextResponse(body, {
      headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  }

  return NextResponse.json(
    { spec: "PUI-001", version: 1, tokens: tokensJson() },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
