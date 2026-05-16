import { NextRequest } from "next/server";
import { subscribeEntityChanges } from "@/lib/sse/listen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: string) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
        );
      };

      // Initial hello + retry hint
      controller.enqueue(encoder.encode(`retry: 5000\n\n`));
      send("hello", JSON.stringify({ ts: Date.now() }));

      const unlisten = await subscribeEntityChanges((_ev, raw) => {
        send("entity_changed", raw);
      });

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          // controller closed underneath
        }
      }, 30_000);

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        try {
          await unlisten();
        } catch {}
        try {
          controller.close();
        } catch {}
      };

      req.signal.addEventListener("abort", () => {
        void cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
