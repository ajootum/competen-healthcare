import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303 See Other, deliberately: the default 307 preserves the POST method,
  // so the browser re-POSTs to /login — a page route — which production
  // rejects with 405 ("This page isn't working"). 303 makes it a GET.
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
