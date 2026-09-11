import { getMigration } from "@/lib/db";

// Server-Sent Events. ponytail: polls sqlite twice a second and ships only new bytes; no pub/sub needed for one viewer.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      let sent = Number(new URL(req.url).searchParams.get("from") ?? 0), lastStatus = "";
      const send = (event: string, data: string) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      for (;;) {
        const m = getMigration(id);
        if (!m) { send("status", "missing"); break; }
        if (m.log.length > sent) { send("log", m.log.slice(sent)); sent = m.log.length; }
        if (m.status !== lastStatus) { send("status", m.status); lastStatus = m.status; }
        if (m.status !== "running") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
