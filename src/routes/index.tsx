import { useChat } from "@ai-sdk/react";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { Mic, MicOff, OctagonX, Send, Trash2, Volume2, VolumeX, Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  APPROVED_SITES,
  MAX_TOOL_ROUNDTRIPS,
  PERMISSION_LEVELS,
  isToolAllowed,
  needsConfirmation,
  validateWebsite,
  type PermissionLevel,
  type ToolName,
} from "@/lib/jarvis/policy";
import { useJarvisStore } from "@/lib/jarvis/store";
import { useVoice } from "@/lib/jarvis/voice";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JARVIS — Personal AI Assistant" },
      { name: "description", content: "A voice-enabled personal AI assistant with memory, permissions, approvals and a full action log." },
      { property: "og:title", content: "JARVIS — Personal AI Assistant" },
      { property: "og:description", content: "Talk to JARVIS. It remembers, acts within your permissions, and logs everything." },
    ],
  }),
  component: Jarvis,
});

const CLIENT_TOOLS: ToolName[] = ["save_memory", "delete_memory", "open_website", "draft_message"];
type ToolInput = { target?: string; content?: string; category?: string; id?: string; channel?: string; to?: string; subject?: string; body?: string };
type Pending = { toolCallId: string; tool: ToolName; input: ToolInput };
type Phase = "IDLE" | "LISTENING" | "PROCESSING" | "AWAITING APPROVAL" | "SPEAKING";

function textOf(m: UIMessage) {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function Jarvis() {
  const store = useJarvisStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const [input, setInput] = useState("");
  const [muted, setMuted] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const roundTrips = useRef(0);
  const halted = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({
        level: storeRef.current.level,
        memories: storeRef.current.memories.map((m) => ({ id: m.id, content: m.content })),
        summary: storeRef.current.summary || undefined,
      }),
    }),
    sendAutomaticallyWhen: (o) => {
      if (halted.current || roundTrips.current >= MAX_TOOL_ROUNDTRIPS) return false;
      const go = lastAssistantMessageIsCompleteWithToolCalls(o);
      if (go) roundTrips.current++;
      return go;
    },
    onToolCall: ({ toolCall }) => {
      const tool = toolCall.toolName as ToolName;
      if (!CLIENT_TOOLS.includes(tool)) return; // server tools already executed
      handleToolCall({ toolCallId: toolCall.toolCallId, tool, input: toolCall.input as ToolInput });
    },
    onFinish: ({ message }) => {
      if (!mutedRef.current && message.role === "assistant") voice.speak(textOf(message));
      maybeSummarize();
    },
    onError: (e) => toast.error(e.message || "Connection to JARVIS failed."),
  });
  const { messages, sendMessage, status, stop, addToolOutput, setMessages } = chat;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const voice = useVoice((text) => send(text));

  function output(p: Pending, out: Record<string, unknown>, status: "executed" | "denied" | "rejected" | "failed", detail: string) {
    store.log({ tool: p.tool, input: p.input, status, detail });
    addToolOutput({ tool: p.tool as never, toolCallId: p.toolCallId, output: out as never });
  }

  // Policy gate → (confirmation) → execute → verify real state → report.
  function handleToolCall(p: Pending) {
    const level = storeRef.current.level;
    if (halted.current) return output(p, { ok: false, reason: "Emergency stop active." }, "rejected", "Emergency stop");
    if (!isToolAllowed(p.tool, level)) return output(p, { ok: false, reason: `Not permitted at level ${level}.` }, "rejected", `Blocked at level ${level}`);
    if (p.tool === "open_website") {
      const v = validateWebsite(p.input.target ?? "");
      if (!v.ok) return output(p, { ok: false, reason: v.reason }, "rejected", v.reason);
    }
    if (needsConfirmation(p.tool, level)) return setPending((q) => [...q, p]);
    execute(p);
  }

  function execute(p: Pending) {
    const s = storeRef.current;
    switch (p.tool) {
      case "save_memory": {
        const m = s.addMemory(p.input.content ?? "", p.input.category ?? "fact");
        return output(p, { ok: true, id: m.id }, "executed", `Saved: ${m.content}`);
      }
      case "delete_memory": {
        const exists = s.memories.some((m) => m.id === p.input.id);
        if (!exists) return output(p, { ok: false, reason: "No memory with that id." }, "failed", "Memory not found");
        s.deleteMemory(p.input.id ?? "");
        return output(p, { ok: true }, "executed", `Deleted ${p.input.id}`);
      }
      case "open_website": {
        const v = validateWebsite(p.input.target ?? "");
        if (!v.ok) return output(p, { ok: false, reason: v.reason }, "rejected", v.reason);
        const w = window.open(v.url, "_blank", "noopener");
        // window.open returns null with noopener; we can only verify popups weren't blocked when it returns a window.
        return output(p, { ok: true, opened: v.url, note: w ? "Tab opened." : "Requested; the browser may have blocked the popup." }, "executed", v.url);
      }
      case "draft_message": {
        const text = `To: ${p.input.to}\nSubject: ${p.input.subject}\n\n${p.input.body}`;
        navigator.clipboard?.writeText(text).catch(() => {});
        return output(p, { ok: true, sent: false, note: `Draft approved and copied to clipboard. Not sent — ${p.input.channel} is not connected yet.` }, "executed", `Draft for ${p.input.to} copied`);
      }
    }
  }

  function decide(p: Pending, approve: boolean) {
    setPending((q) => q.filter((x) => x.toolCallId !== p.toolCallId));
    if (approve) execute(p);
    else output(p, { ok: false, reason: "The user declined this action." }, "denied", "Declined by user");
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || status === "submitted" || status === "streaming") return;
    halted.current = false;
    roundTrips.current = 0;
    voice.silence();
    sendMessage({ text: t });
    setInput("");
    inputRef.current?.focus();
  }

  function emergencyStop() {
    halted.current = true;
    stop();
    voice.silence();
    voice.stop();
    pending.forEach((p) => output(p, { ok: false, reason: "Emergency stop." }, "rejected", "Emergency stop"));
    setPending([]);
    store.log({ tool: "EMERGENCY_STOP", input: {}, status: "executed", detail: "All tasks halted" });
    toast.warning("Emergency stop — all tasks halted.");
  }

  // Compress old turns into a summary so we don't resend the entire history.
  const summarizing = useRef(false);
  async function maybeSummarize() {
    const msgs = chat.messages;
    if (summarizing.current || msgs.length < 24) return;
    let cut = 16;
    while (cut < msgs.length && msgs[cut]?.role !== "user") cut++;
    if (cut >= msgs.length - 2) return;
    summarizing.current = true;
    try {
      const text = msgs.slice(0, cut).map((m) => `${m.role}: ${textOf(m)}`).join("\n");
      const r = await fetch("/api/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, previous: storeRef.current.summary }) });
      const j = await r.json();
      if (r.ok && j.summary) {
        storeRef.current.setSummary(j.summary);
        setMessages(chat.messages.slice(cut));
      }
    } finally {
      summarizing.current = false;
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  const busy = status === "submitted" || status === "streaming";
  const phase: Phase = voice.listening ? "LISTENING" : pending.length ? "AWAITING APPROVAL" : busy ? "PROCESSING" : voice.speaking ? "SPEAKING" : "IDLE";

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 lg:h-screen lg:flex-row">
      {/* Left: core + chat */}
      <section className="flex min-h-0 flex-1 flex-col gap-4">
        <header className="hud-panel flex flex-wrap items-center gap-4 p-4">
          <Reactor phase={phase} />
          <div className="mr-auto">
            <h1 className="text-3xl font-bold tracking-[0.3em] text-primary">J.A.R.V.I.S.</h1>
            <p className="hud-label">Status · {phase}</p>
          </div>
          <Button variant="outline" size="icon" aria-label={muted ? "Unmute voice" : "Mute voice"} onClick={() => { setMuted(!muted); voice.silence(); }}>
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Button variant="destructive" onClick={emergencyStop} aria-label="Emergency stop" className="font-mono tracking-widest">
            <OctagonX /> STOP
          </Button>
        </header>

        <div ref={scrollRef} className="hud-panel min-h-[50vh] flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-2xl text-foreground">Good day. How may I assist?</p>
              <p className="mt-2 text-sm text-muted-foreground">Try “What's 18% of 2,450?”, “Remember I prefer tea”, or “Open YouTube”.</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] space-y-2", m.role === "user" && "rounded-lg bg-primary px-4 py-2 text-primary-foreground")}>
                {m.parts.map((p, i) => {
                  if (p.type === "text") return <div key={i} className="prose prose-invert prose-sm max-w-none text-base"><ReactMarkdown>{p.text}</ReactMarkdown></div>;
                  if (p.type.startsWith("tool-")) {
                    const tp = p as { type: string; state: string; output?: { ok?: boolean; reason?: string } };
                    const name = tp.type.slice(5);
                    const ok = tp.output?.ok;
                    return (
                      <div key={i} className="hud-label flex items-center gap-2 rounded border border-border px-2 py-1">
                        <span className={cn("h-1.5 w-1.5 rounded-full", tp.state !== "output-available" ? "animate-pulse bg-accent" : ok ? "bg-success" : "bg-destructive")} />
                        {name} · {tp.state !== "output-available" ? "pending" : ok ? "verified ok" : `failed${tp.output?.reason ? ` — ${tp.output.reason}` : ""}`}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          ))}
          {status === "submitted" && <p className="hud-label animate-pulse">Processing…</p>}
          {pending.map((p) => (
            <div key={p.toolCallId} className="rounded-lg border border-accent bg-card p-4">
              <p className="hud-label text-accent">Approval required · {p.tool.replace("_", " ")}</p>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-sm">{p.tool === "draft_message" ? `${p.input.channel} → ${p.input.to}\nSubject: ${p.input.subject}\n\n${p.input.body}` : JSON.stringify(p.input, null, 2)}</pre>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => decide(p, true)}><Check /> Approve</Button>
                <Button size="sm" variant="outline" onClick={() => decide(p, false)}><X /> Decline</Button>
              </div>
            </div>
          ))}
        </div>

        <form className="hud-panel flex items-end gap-2 p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <Button
            type="button"
            size="icon"
            variant={voice.listening ? "default" : "outline"}
            disabled={!voice.supported}
            aria-label="Hold to talk"
            title={voice.supported ? "Hold to talk (or hold Space outside the text box)" : "Voice needs Chrome or Edge"}
            onPointerDown={voice.start}
            onPointerUp={voice.stop}
            onPointerLeave={() => voice.listening && voice.stop()}
            className={cn(voice.listening && "shadow-glow animate-reactor-pulse")}
          >
            {voice.supported ? <Mic /> : <MicOff />}
          </Button>
          <Textarea
            ref={inputRef}
            autoFocus
            rows={1}
            value={voice.listening ? voice.interim : input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder={voice.listening ? "Listening…" : "Speak or type a command"}
            className="min-h-10 flex-1 resize-none text-base"
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send"><Send /></Button>
        </form>
        {voice.error && <p className="text-sm text-destructive">{voice.error}</p>}
      </section>

      {/* Right: control panel */}
      <aside className="hud-panel flex min-h-0 w-full flex-col p-4 lg:w-96">
        <Tabs defaultValue="permissions" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="permissions">Access</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="audit">Log</TabsTrigger>
          </TabsList>

          <TabsContent value="permissions" className="space-y-2 overflow-y-auto">
            {([1, 2, 3, 4, 5] as PermissionLevel[]).map((l) => (
              <button
                key={l}
                onClick={() => { store.setLevel(l); store.log({ tool: "SET_LEVEL", input: { level: l }, status: "executed", detail: PERMISSION_LEVELS[l].name }); }}
                className={cn("w-full rounded-md border p-3 text-left transition", store.level === l ? "border-primary bg-primary/10 shadow-glow" : "border-border hover:border-primary/50")}
              >
                <p className="font-semibold">Level {l} · {PERMISSION_LEVELS[l].name}</p>
                <p className="text-sm text-muted-foreground">{PERMISSION_LEVELS[l].description}</p>
              </button>
            ))}
            <p className="hud-label pt-3">Approved websites</p>
            <div className="flex flex-wrap gap-1">
              {APPROVED_SITES.map((s) => <span key={s.id} className="rounded border border-border px-2 py-0.5 font-mono text-xs">{s.label}</span>)}
            </div>
          </TabsContent>

          <TabsContent value="memory" className="space-y-2 overflow-y-auto">
            {store.summary && (
              <div className="rounded-md border border-border p-3">
                <p className="hud-label">Conversation summary</p>
                <p className="mt-1 text-sm">{store.summary}</p>
                <Button size="sm" variant="ghost" onClick={() => store.setSummary("")}>Clear</Button>
              </div>
            )}
            {store.memories.length === 0 && <p className="text-sm text-muted-foreground">Nothing remembered yet. Tell JARVIS something about yourself.</p>}
            {store.memories.map((m) => (
              <div key={m.id} className="flex items-start gap-2 rounded-md border border-border p-3">
                <div className="flex-1">
                  <p className="hud-label">{m.category} · {new Date(m.createdAt).toLocaleDateString()}</p>
                  <p className="text-sm">{m.content}</p>
                </div>
                <Button size="icon" variant="ghost" aria-label="Delete memory" onClick={() => { store.deleteMemory(m.id); store.log({ tool: "delete_memory (manual)", input: { id: m.id }, status: "executed", detail: m.content }); }}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="audit" className="flex min-h-0 flex-col">
            <div className="mb-2 flex justify-between">
              <p className="hud-label">{store.audit.length} actions</p>
              <Button size="sm" variant="ghost" onClick={store.clearAudit}>Clear</Button>
            </div>
            <div className="space-y-1 overflow-y-auto font-mono text-xs">
              {store.audit.map((a) => (
                <div key={a.id} className="rounded border border-border p-2">
                  <span className={cn(a.status === "executed" ? "text-success" : "text-destructive")}>{a.status.toUpperCase()}</span>{" "}
                  <span className="text-primary">{a.tool}</span>
                  <span className="float-right text-muted-foreground">{new Date(a.at).toLocaleTimeString()}</span>
                  <p className="text-muted-foreground">{a.detail}</p>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </aside>
    </main>
  );
}

function Reactor({ phase }: { phase: Phase }) {
  const active = phase !== "IDLE";
  return (
    <div className="relative h-14 w-14">
      <div className="absolute inset-0 rounded-full border-2 border-dashed border-primary/60 animate-reactor-spin" />
      <div className={cn("absolute inset-2 rounded-full border border-primary", phase === "AWAITING APPROVAL" && "border-accent")} />
      <div className={cn("absolute inset-4 rounded-full bg-primary shadow-glow", active && "animate-reactor-pulse", phase === "AWAITING APPROVAL" && "bg-accent")} />
    </div>
  );
}
