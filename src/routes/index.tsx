import { useChat } from "@ai-sdk/react";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { Monitor, Mic, MicOff, OctagonX, Send, Trash2, Volume2, VolumeX, Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  APPROVED_APPS,
  APPROVED_SITES,
  MAX_TOOL_ROUNDTRIPS,
  PC_TOOLS,
  isSafeWorkspacePath,
  PERMISSION_LEVELS,
  isToolAllowed,
  needsConfirmation,
  validateScreenText,
  validateWebsite,
  type PermissionLevel,
  type ToolName,
} from "@/lib/jarvis/policy";
import { useJarvisStore } from "@/lib/jarvis/store";
import { callHelper, useHelper } from "@/lib/jarvis/helper-client";
import { Input } from "@/components/ui/input";
import { useVoice } from "@/lib/jarvis/voice";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { AuthScreen } from "@/components/AuthScreen";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function JarvisGate() {
  const [user, setUser] = useState<{ id: string; email?: string } | null | undefined>(undefined);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (user === undefined) return <div className="min-h-screen bg-background" />;
  if (!user) return <AuthScreen />;
  return <Jarvis key={user.id} userId={user.id} email={user.email} />;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JARVIS — Personal AI Assistant" },
      { name: "description", content: "A voice-enabled personal AI assistant with memory, permissions, approvals and a full action log." },
      { property: "og:title", content: "JARVIS — Personal AI Assistant" },
      { property: "og:description", content: "Talk to JARVIS. It remembers, acts within your permissions, and logs everything." },
    ],
  }),
  component: JarvisGate,
});

const CLIENT_TOOLS: ToolName[] = ["save_memory", "delete_memory", "open_website", "draft_message", ...PC_TOOLS];
type ToolInput = { target?: string; content?: string; category?: string; id?: string; channel?: string; to?: string; subject?: string; body?: string; summary?: string; start?: string; end?: string; description?: string; timeZone?: string; app?: string; path?: string; query?: string; reason?: string; x?: number; y?: number; text?: string; screen_token?: string };
type Pending = { toolCallId: string; tool: ToolName; input: ToolInput; diff?: string };
type Phase = "IDLE" | "LISTENING" | "PROCESSING" | "AWAITING APPROVAL" | "SPEAKING";

function textOf(m: UIMessage) {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function Jarvis({ userId, email }: { userId: string; email?: string }) {
  const store = useJarvisStore(userId);
  const storeRef = useRef(store);
  storeRef.current = store;
  const [input, setInput] = useState("");
  const [muted, setMuted] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [shots, setShots] = useState<string[]>([]);
  const helper = useHelper();
  const [pairCode, setPairCode] = useState("");
  const roundTrips = useRef(0);
  const halted = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: authHeaders,
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
    onError: (e) => {
      if (/sign in/i.test(e.message)) toast.error("Please sign in again.");
      else toast.error(e.message || "Connection to JARVIS failed.");
    },
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
    if (p.input.path !== undefined && !isSafeWorkspacePath(p.input.path)) {
      return output(p, { ok: false, reason: "That path is outside the workspace." }, "rejected", `Blocked path ${p.input.path}`);
    }
    if (p.tool === "screen_type") {
      const v = validateScreenText(p.input.text ?? "");
      if (!v.ok) return output(p, { ok: false, reason: v.reason }, "rejected", v.reason);
    }
    if (needsConfirmation(p.tool, level)) {
      if (p.tool === "write_file") {
        // Show a real diff from the PC before asking for approval.
        callHelper("/files/preview", { path: p.input.path, content: p.input.content }).then((r) => {
          if (!r.ok) return output(p, r, "failed", r.reason ?? "Preview failed");
          setPending((q) => [...q, { ...p, diff: String(r["diff"] ?? "") }]);
        });
        return;
      }
      return setPending((q) => [...q, p]);
    }
    execute(p);
  }

  async function runGoogle(p: Pending) {
    const body =
      p.tool === "create_event"
        ? { action: "create_event", summary: p.input.summary, start: p.input.start, end: p.input.end, description: p.input.description, timeZone: p.input.timeZone }
        : { action: "send_email", to: p.input.to, subject: p.input.subject, body: p.input.body };
    let r: { ok: boolean; reason?: string; [k: string]: unknown };
    try {
      const res = await fetch("/api/google", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      r = await res.json().catch(() => ({ ok: false, reason: `Server replied ${res.status}` }));
      if (res.status === 401) r = { ok: false, reason: "You are signed out." };
    } catch {
      r = { ok: false, reason: "Network error — nothing was sent." };
    }
    if (halted.current) return;
    const what = p.tool === "create_event" ? `Event "${p.input.summary}"` : `Email to ${p.input.to}`;
    output(p, r, r.ok ? "executed" : "failed", r.ok ? `${what} — verified` : `${what}: ${r.reason ?? "failed"}`);
  }

  async function runPc(p: Pending) {
    const routes: Partial<Record<ToolName, [string, Record<string, unknown>]>> = {
      launch_app: ["/apps/launch", { app: p.input.app }],
      list_files: ["/files/list", { path: p.input.path ?? "" }],
      search_files: ["/files/search", { query: p.input.query }],
      read_file: ["/files/read", { path: p.input.path }],
      write_file: ["/files/write", { path: p.input.path, content: p.input.content }],
      restore_file: ["/files/restore", { path: p.input.path }],
      take_screenshot: ["/screen/capture", {}],
      screen_click: ["/screen/click", { screen_token: p.input.screen_token, x: p.input.x, y: p.input.y }],
      screen_type: ["/screen/type", { screen_token: p.input.screen_token, text: p.input.text }],
    };
    const [path, body] = routes[p.tool]!;
    const r = await callHelper(path, body, p.tool === "launch_app" ? 20000 : 15000);
    if (halted.current) return;
    if (p.tool === "take_screenshot" && r.ok) {
      setShots((x) => [`data:image/png;base64,${r["png_base64"]}`, ...x].slice(0, 3));
      // The image goes to the model (server converts it to an image input) so it can see the screen.
      return output(p, { ok: true, width: r["width"], height: r["height"], screen_token: r["screen_token"], foreground_app: r["foreground_app"] ?? null, png_base64: r["png_base64"] }, "executed", `Screenshot captured (front app: ${r["foreground_app"] ?? "none approved"})`);
    }
    if (p.tool === "screen_type" && r.ok) {
      return output(p, r, "executed", `Typed ${p.input.text?.length ?? 0} characters into ${String(r["app"])}`);
    }
    output(p, r, r.ok ? "executed" : "failed", r.ok ? `${p.tool} ${p.input.app ?? p.input.path ?? p.input.query ?? ""}` : (r.reason ?? "Failed"));
  }

  function execute(p: Pending) {
    const s = storeRef.current;
    if (PC_TOOLS.includes(p.tool)) return void runPc(p);
    if (p.tool === "create_event" || (p.tool === "draft_message" && p.input.channel === "email")) return void runGoogle(p);
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
      const r = await fetch("/api/summarize", { method: "POST", body: JSON.stringify({ text, previous: storeRef.current.summary }), headers: { "Content-Type": "application/json", ...(await authHeaders()) } });
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
          <span className="hud-label flex items-center gap-1.5" title="Windows helper">
            <Monitor className="h-4 w-4" />
            <span className={cn("h-2 w-2 rounded-full", helper.status === "online" ? "bg-success" : helper.status === "offline" ? "bg-destructive" : "bg-muted-foreground")} />
            PC {helper.status}
          </span>
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
              <p className="mt-2 text-sm text-muted-foreground">Try “What's in the news today?”, “Remember I prefer tea”, or “Type a shopping list in Notepad”.</p>
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
          {shots.map((src, i) => (
            <img key={i} src={src} alt="Screenshot of your PC" className="max-h-72 rounded-md border border-border" />
          ))}
          {pending.map((p) => (
            <div key={p.toolCallId} className="rounded-lg border border-accent bg-card p-4">
              <p className="hud-label text-accent">Approval required · {p.tool.replace("_", " ")}</p>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-sm">{p.diff !== undefined ? <DiffView diff={p.diff} /> : p.tool === "create_event" ? `${p.input.summary}\n${p.input.start} → ${p.input.end}${p.input.description ? `\n\n${p.input.description}` : ""}` : p.tool === "draft_message" ? `${p.input.channel} → ${p.input.to}\nSubject: ${p.input.subject}\n\n${p.input.body}` : p.tool === "screen_click" ? `Click “${p.input.target ?? "?"}” at (${p.input.x}, ${p.input.y})` : p.tool === "screen_type" ? `Type into the front app:\n\n${p.input.text}` : JSON.stringify(p.input, null, 2)}</pre>
              {p.tool === "screen_click" && shots[0] && (
                <div className="relative mt-2 inline-block">
                  <img src={shots[0]} alt="Where JARVIS wants to click" className="max-h-72 rounded-md border border-border" />
                  <ClickMarker x={p.input.x ?? 0} y={p.input.y ?? 0} src={shots[0]} />
                </div>
              )}
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="permissions">Access</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="audit">Log</TabsTrigger>
            <TabsTrigger value="pc">PC</TabsTrigger>
          </TabsList>

          <TabsContent value="pc" className="space-y-3 overflow-y-auto text-sm">
            <p className="hud-label">Windows helper · {helper.status}</p>
            {helper.status === "online" && (
              <p className="rounded-md border border-success/40 p-2">Connected. Workspace: <span className="font-mono text-xs">{String(helper.info?.["workspace"] ?? "")}</span></p>
            )}
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Install Python 3.10+ on your PC.</li>
              <li>Download the helper files below into one folder.</li>
              <li>In that folder run <span className="font-mono text-foreground">python jarvis_helper.py</span> (not as admin).</li>
              <li>Paste the pairing code it shows here.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline"><a href="/jarvis-helper/jarvis_helper.py" download>jarvis_helper.py</a></Button>
              <Button asChild size="sm" variant="outline"><a href="/jarvis-helper/README.txt" download>README.txt</a></Button>
              <Button asChild size="sm" variant="ghost"><a href="/jarvis-helper/test_jarvis_helper.py" download>tests</a></Button>
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (pairCode.trim()) { helper.pair(pairCode); setPairCode(""); store.log({ tool: "PAIR_HELPER", input: {}, status: "executed", detail: "Pairing code saved" }); } }}>
              <Input type="password" placeholder="Pairing code" value={pairCode} onChange={(e) => setPairCode(e.target.value)} />
              <Button type="submit" size="sm">Connect</Button>
            </form>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={helper.check}>Re-check</Button>
              {helper.token && <Button size="sm" variant="ghost" onClick={helper.unpair}>Forget pairing</Button>}
            </div>
            <p className="text-xs text-muted-foreground">Allowed apps: {APPROVED_APPS.join(", ")}. Screen clicks and typing work only in Calculator, Notepad or Paint when they are in front, and you approve each one. Files only inside the workspace folder. Writes show a diff first and keep a backup you can restore.</p>
          </TabsContent>

          <TabsContent value="permissions" className="space-y-2 overflow-y-auto">
            <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
              <span className="truncate text-muted-foreground">Signed in as {email ?? "you"}</span>
              <Button size="sm" variant="ghost" onClick={() => { stop(); supabase.auth.signOut(); }}>Sign out</Button>
            </div>
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

function ClickMarker({ x, y, src }: { x: number; y: number; src: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);
  if (!size) return null;
  return <span className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/40 shadow-glow" style={{ left: `${(x / size.w) * 100}%`, top: `${(y / size.h) * 100}%` }} />;
}

function DiffView({ diff }: { diff: string }) {
  return (
    <>
      {diff.split("\n").map((l, i) => (
        <span key={i} className={cn("block", l.startsWith("+") && !l.startsWith("+++") ? "text-success" : l.startsWith("-") && !l.startsWith("---") ? "text-destructive" : "text-muted-foreground")}>{l || " "}</span>
      ))}
    </>
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
