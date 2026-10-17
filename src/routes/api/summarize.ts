import { createFileRoute } from "@tanstack/react-router";
import { handleSummarize } from "@/lib/jarvis/chat.server";

export const Route = createFileRoute("/api/summarize")({
  server: { handlers: { POST: ({ request }) => handleSummarize(request) } },
});
