import { useEffect, useState } from "react";
import { z } from "zod";
import { Smartphone, Settings, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { androidAvailable, callAndroid } from "@/lib/jarvis/android-client";

const appsSchema = z.array(z.object({ label: z.string().max(200), package_name: z.string().regex(/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/).max(200) })).max(200);
export type AndroidApp = z.infer<typeof appsSchema>[number];

export function AndroidControls({ onApps, onLog }: { onApps: (apps: AndroidApp[]) => void; onLog: (detail: string) => void }) {
  const [ready, setReady] = useState(false);
  const [apps, setApps] = useState<AndroidApp[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () => setReady(androidAvailable());
    update(); window.addEventListener("jarvis-android-ready", update);
    return () => window.removeEventListener("jarvis-android-ready", update);
  }, []);
  if (!ready) return null;
  async function choose() {
    setBusy(true);
    const r = await callAndroid("apps");
    const parsed = appsSchema.safeParse(r.apps);
    if (r.ok && parsed.success) { setApps(parsed.data); onApps(parsed.data); onLog(`${parsed.data.length} Android launch targets approved on device`); setMessage(""); }
    else setMessage(r.reason ?? "No apps selected.");
    setBusy(false);
  }
  return <div className="space-y-2 border-t border-border pt-3 text-sm">
    <p className="hud-label flex items-center gap-2"><Smartphone className="h-4 w-4" />Android · connected</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={choose}><RefreshCw />Choose apps</Button>
      <Button size="sm" variant="outline" onClick={async () => { const r = await callAndroid("accessibility"); setMessage(r.reason ?? "Settings requested."); }}><Settings />YouTube access</Button>
    </div>
    {apps.map(app => <p key={app.package_name} className="text-muted-foreground">{app.label}</p>)}
    {message && <p className="text-muted-foreground" role="status">{message}</p>}
  </div>;
}