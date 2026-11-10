import { z } from "zod";

const replySchema = z.object({ id: z.string(), result: z.object({ ok: z.boolean(), reason: z.string().optional() }).passthrough() });
type Reply = z.infer<typeof replySchema>["result"];
let port: MessagePort | undefined;
const waiting = new Map<string, (result: Reply) => void>();

export function connectAndroid(): () => void {
  const listener = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.data !== "jarvis-native-v1" || !event.ports[0]) return;
    port?.close();
    port = event.ports[0];
    port.onmessage = ({ data }) => {
      let parsed: unknown;
      try { parsed = JSON.parse(data); } catch { return; }
      const r = replySchema.safeParse(parsed);
      if (!r.success) return;
      waiting.get(r.data.id)?.(r.data.result);
      waiting.delete(r.data.id);
    };
    port.start();
    window.dispatchEvent(new Event("jarvis-android-ready"));
  };
  window.addEventListener("message", listener);
  return () => {
    window.removeEventListener("message", listener);
    port?.close();
    port = undefined;
    waiting.forEach(resolve => resolve({ ok: false, reason: "Android connection closed." }));
    waiting.clear();
  };
}

export function androidAvailable() { return Boolean(port); }

export function callAndroid(action: string, input: Record<string, unknown> = {}): Promise<Reply> {
  if (!port) return Promise.resolve({ ok: false, reason: "This action needs the updated Android companion." });
  const id = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      waiting.delete(id);
      resolve({ ok: false, reason: "Android did not confirm a result. Do not retry a submission without checking the phone." });
    }, 60000);
    waiting.set(id, result => { window.clearTimeout(timer); resolve(result); });
    port?.postMessage(JSON.stringify({ id, action, input }));
  });
}