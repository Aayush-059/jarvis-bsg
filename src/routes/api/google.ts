import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createEvent, sendEmail } from "@/lib/jarvis/google.server";
import { getCaller } from "@/lib/jarvis/auth.server";

// Consequential Google actions. Only called by the browser AFTER the user approved.
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send_email"), to: z.string().max(320), subject: z.string().max(300), body: z.string().max(20000) }),
  z.object({ action: z.literal("create_event"), summary: z.string().max(300), start: z.string(), end: z.string(), description: z.string().max(5000).optional(), timeZone: z.string().max(60).optional() }),
]);

export const Route = createFileRoute("/api/google")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await getCaller(request);
        if (caller instanceof Response) return caller;
        if (!caller.isOwner) return Response.json({ ok: false, reason: "Gmail and Calendar aren't connected for your account yet." }, { status: 403 });
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: false, reason: "Invalid request." }, { status: 400 });
        const d = parsed.data;
        const result = d.action === "send_email" ? await sendEmail(d) : await createEvent(d);
        return Response.json(result);
      },
    },
  },
});
