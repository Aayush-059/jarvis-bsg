import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DESTINATIONS, SERVICE_CATEGORIES } from "@/lib/jarvis/destinations";
import { isToolAllowed, needsConfirmation, validateWebsite, type PermissionLevel } from "@/lib/jarvis/policy";
import { toast } from "sonner";

export function ServiceDirectory({ level, onRequest }: { level: PermissionLevel; onRequest: (url: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const matches = DESTINATIONS.filter(s => (category === "All" || s.category === category) && `${s.label} ${s.id}`.toLowerCase().includes(query.toLowerCase().trim()));
  function open(id: string) {
    if (!isToolAllowed("open_website", level)) return toast.error("Opening websites needs access level 4 or 5.");
    const result = validateWebsite(id);
    if (!result.ok) return toast.error(result.reason);
    if (needsConfirmation("open_website", level) && !window.confirm(`Open ${result.url} in your browser?`)) return;
    window.open(result.url, "_blank", "noopener,noreferrer");
    onRequest(result.url);
    toast.info("Opening requested. Check your browser if no tab appears.");
  }
  return <div className="space-y-3">
    <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search services" placeholder="Search services and games" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" /></div>
    <div className="flex flex-wrap gap-1">{["All", ...SERVICE_CATEGORIES].map(c => <Button key={c} size="sm" variant={category === c ? "default" : "outline"} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</Button>)}</div>
    <p className="text-xs text-muted-foreground">Account access: not connected here. Websites use your browser’s signed-in account. Game links open official websites, not gameplay controls.</p>
    <div className="divide-y divide-border">{matches.map(s => <div key={s.id} className="flex items-center justify-between gap-2 py-2"><div className="min-w-0"><p className="break-words text-sm">{s.label}</p><p className="text-xs text-muted-foreground">{s.category}</p></div><Button size="icon" variant="ghost" aria-label={`Open ${s.label}`} title={`Open ${s.label}`} onClick={() => open(s.id)}><ExternalLink className="h-4 w-4" /></Button></div>)}</div>
    {!matches.length && <p className="text-sm text-muted-foreground">No matching destinations.</p>}
  </div>;
}