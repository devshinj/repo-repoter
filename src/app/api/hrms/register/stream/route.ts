import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { subscribeJob } from "@/infra/hrms/registration-jobs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const jobId = Number(request.nextUrl.searchParams.get("jobId"));
  if (!jobId || isNaN(jobId)) {
    return new Response("jobId is required", { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream already closed
        }
      };

      unsubscribe = subscribeJob(jobId, (event) => {
        send(event);
        if (event.step === "done" || event.step === "error") {
          try { controller.close(); } catch { /* already closed */ }
        }
      });

      if (!unsubscribe) {
        // job이 존재하지 않음 (이미 만료되었거나 잘못된 ID)
        send({ step: "error", message: "작업을 찾을 수 없습니다.", error: "Job not found" });
        try { controller.close(); } catch { /* ignore */ }
      }
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
