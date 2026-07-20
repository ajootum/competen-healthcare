import Anthropic from "@anthropic-ai/sdk";
import { getCaller, isResponse } from "@/lib/api-auth";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an AI Clinical Copilot for Competen Healthcare, supporting nurses and clinical staff across East Africa (Kenya, Uganda, Tanzania, Rwanda, and Ethiopia).

Your role:
- Answer evidence-based clinical questions concisely and accurately
- Reference East African clinical contexts where relevant (Kenya Essential Medicines List, WHO AFRO guidelines, NCK/UNMC/TNMC standards)
- Support competency development aligned with East African nursing frameworks
- Cover: BLS/ALS, medication safety, infection control, pediatrics, wound care, critical care, patient assessment, pharmacology, and clinical procedures

Your tone: Professional, supportive, educational. You are a knowledgeable colleague, not a replacement for senior clinical staff.

Always end responses that involve patient care decisions with: "Follow your hospital's protocols and consult senior staff for patient-specific decisions."

Keep responses concise — 3–5 sentences for simple questions, structured bullet points for complex ones.`;

export async function POST(request: Request) {
  // Authenticated users only — this endpoint proxies a paid LLM (clinical copilot
  // for nurses & staff), never anonymous.
  const c = await getCaller();
  if (isResponse(c)) return c;

  const { messages } = await request.json();

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured. Add it to .env.local." }, { status: 500 });
  }

  const stream = client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
            );
          }
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
        );
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
