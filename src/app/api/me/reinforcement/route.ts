import { NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { learnerReinforcement, reviewCard } from "@/lib/delivery/reinforcement";

// CDP-004 — learner reinforcement API. GET returns the caller's due review cards + stats; POST {card_id,
// quality 0..5} records a self-graded recall and reschedules via SM-2. Any authenticated user, own cards only.

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  return NextResponse.json(await learnerReinforcement(c.admin, c.userId));
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  const cardId = String(b.card_id ?? "");
  const quality = Number(b.quality);
  if (!cardId || Number.isNaN(quality)) return NextResponse.json({ error: "card_id and quality (0..5) required" }, { status: 400 });
  const r = await reviewCard(c.admin, cardId, c.userId, quality);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
