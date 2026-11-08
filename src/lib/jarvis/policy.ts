// JARVIS safety policy — pure, shared by server and browser so both sides
// enforce the same rules (defense in depth). No side effects in this file.
import { DESTINATIONS } from "./destinations";

export type PermissionLevel = 1 | 2 | 3 | 4 | 5;

export const PERMISSION_LEVELS: Record<PermissionLevel, { name: string; description: string }> = {
  1: { name: "Answer only", description: "Talks. Takes no actions." },
  2: { name: "Compute", description: "Can calculate and check the time." },
  3: { name: "Remember", description: "Can also save memories." },
  4: { name: "Act with approval", description: "Can open sites, draft messages, delete memories — every action asks first." },
  5: { name: "Bounded autonomy", description: "Opens approved sites without asking. Deletions and messages still ask." },
};

export type ToolName =
  | "calculate"
  | "get_current_time"
  | "save_memory"
  | "delete_memory"
  | "open_website"
  | "draft_message"
  | "launch_app"
  | "list_files"
  | "search_files"
  | "read_file"
  | "write_file"
  | "restore_file"
  | "take_screenshot"
  | "list_events"
  | "create_event"
  | "search_email"
  | "read_email"
  | "web_search"
  | "screen_click"
  | "screen_type";

/** Minimum permission level required to even offer a tool to the model. */
export const TOOL_MIN_LEVEL: Record<ToolName, PermissionLevel> = {
  calculate: 2,
  get_current_time: 2,
  save_memory: 3,
  delete_memory: 4,
  open_website: 4,
  draft_message: 4,
  list_files: 3,
  search_files: 3,
  read_file: 3,
  launch_app: 4,
  write_file: 4,
  restore_file: 4,
  take_screenshot: 4,
  list_events: 3,
  search_email: 3,
  read_email: 3,
  create_event: 4,
  web_search: 2,
  screen_click: 4,
  screen_type: 4,
};

/** Tools executed by the Windows helper on the user's PC. */
export const PC_TOOLS: ToolName[] = ["launch_app", "list_files", "search_files", "read_file", "write_file", "restore_file", "take_screenshot", "screen_click", "screen_type"];

/** Apps the helper may launch. Must match APPS in public/jarvis-helper/jarvis_helper.py. */
export const APPROVED_APPS = ["calculator", "notepad", "paint", "explorer", "edge", "chrome", "firefox", "spotify", "discord", "steam"] as const;

/** Tools that are always confirmed by the user, at any level. */
const ALWAYS_CONFIRM: ToolName[] = ["delete_memory", "draft_message", "create_event", "launch_app", "write_file", "restore_file", "take_screenshot", "screen_click", "screen_type"];

/** Validates screen-typing text: bounded, printable, no control keys (helper re-checks). */
export function validateScreenText(t: string): { ok: true } | { ok: false; reason: string } {
  if (!t || t.length > 500) return { ok: false, reason: "Text must be 1-500 characters." };
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(t)) return { ok: false, reason: "Control characters and shortcuts are not allowed." };
  return { ok: true };
}

export function toolsForLevel(level: PermissionLevel): ToolName[] {
  return (Object.keys(TOOL_MIN_LEVEL) as ToolName[]).filter((t) => TOOL_MIN_LEVEL[t] <= level);
}

export function isToolAllowed(tool: string, level: PermissionLevel): tool is ToolName {
  return tool in TOOL_MIN_LEVEL && TOOL_MIN_LEVEL[tool as ToolName] <= level;
}

export function needsConfirmation(tool: ToolName, level: PermissionLevel): boolean {
  if (ALWAYS_CONFIRM.includes(tool)) return true;
  if (tool === "open_website" || tool === "launch_app") return level < 5;
  return false;
}

/** Approved websites. Only these hosts (and their subdomains) may be opened. */
export const APPROVED_SITES = DESTINATIONS;

const APPROVED_HOSTS = ["google.com", "youtube.com", "github.com", "wikipedia.org"];

/** Returns a normalized https URL if approved, otherwise a rejection reason. */
export function validateWebsite(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const byId = APPROVED_SITES.find((s) => s.id === raw.trim().toLowerCase());
  if (byId) return { ok: true, url: byId.url };
  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: "Not a valid web address." };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "Only secure https sites are allowed." };
  if (u.username || u.password) return { ok: false, reason: "Addresses with credentials are blocked." };
  if (u.port && u.port !== "443") return { ok: false, reason: "Non-standard ports are blocked." };
  const host = u.hostname.toLowerCase();
  const approved = APPROVED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ||
    APPROVED_SITES.some((s) => {
      const official = new URL(s.url).hostname.replace(/^www\./, "");
      return host === official || host === `www.${official}`;
    });
  if (!approved) return { ok: false, reason: `${host} is not on the approved list.` };
  return { ok: true, url: u.toString() };
}

/**
 * Safe calculator: a tiny recursive-descent parser. Never uses eval/Function,
 * so the model cannot smuggle code through "math".
 */
export function safeCalculate(expr: string): { ok: true; value: number } | { ok: false; reason: string } {
  if (expr.length > 200) return { ok: false, reason: "Expression too long." };
  if (!/^[\d\s+\-*/().%^]+$/.test(expr)) return { ok: false, reason: "Only numbers and + - * / % ^ ( ) are allowed." };
  let i = 0;
  const s = expr.replace(/\s+/g, "");
  const peek = () => s[i];
  const num = (): number => {
    if (peek() === "(") {
      i++;
      const v = add();
      if (peek() !== ")") throw new Error("Missing )");
      i++;
      return v;
    }
    if (peek() === "-") { i++; return -num(); }
    const m = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (!m) throw new Error("Expected a number");
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const pow = (): number => {
    const b = num();
    if (peek() === "^") { i++; return Math.pow(b, pow()); }
    return b;
  };
  const mul = (): number => {
    let v = pow();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = s[i++];
      const r = pow();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const r = mul();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = add();
    if (i !== s.length) return { ok: false, reason: "Unexpected characters." };
    if (!Number.isFinite(v)) return { ok: false, reason: "Result is not a finite number." };
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Max model steps per request and max client tool round-trips per user turn. */
export const MAX_SERVER_STEPS = 6;
export const MAX_TOOL_ROUNDTRIPS = 6;

/** Browser-side mirror of the helper's path rule (the helper re-checks). */
export function isSafeWorkspacePath(rel: string): boolean {
  const r = rel.trim().replace(/\\/g, "/");
  if (r.length > 260 || r.startsWith("/") || r.startsWith("~") || r.includes(":")) return false;
  return !r.split("/").includes("..");
}

/** Tools that use the owner's connected Gmail/Calendar. Only the owner account may use them. */
export const GOOGLE_TOOLS: ToolName[] = ["list_events", "create_event", "search_email", "read_email"];

/** Shared owner connections never become available merely by raising permission level. */
export function toolsForAccount(level: PermissionLevel, isOwner: boolean): ToolName[] {
  return toolsForLevel(level).filter(t => isOwner || !GOOGLE_TOOLS.includes(t));
}
