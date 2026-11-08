import { describe, expect, it } from "vitest";
import { APPROVED_SITES, isSafeWorkspacePath, isToolAllowed, needsConfirmation, safeCalculate, toolsForAccount, toolsForLevel, validateScreenText, validateWebsite } from "@/lib/jarvis/policy";

describe("permission levels", () => {
  it("level 1 offers no tools", () => expect(toolsForLevel(1)).toEqual([]));
  it("level 3 cannot open websites", () => expect(isToolAllowed("open_website", 3)).toBe(false));
  it("unknown tools are rejected", () => expect(isToolAllowed("run_shell", 5)).toBe(false));
  it("deleting memory always asks, even at level 5", () => expect(needsConfirmation("delete_memory", 5)).toBe(true));
  it("drafting a message always asks", () => expect(needsConfirmation("draft_message", 5)).toBe(true));
  it("opening a site asks at level 4 but not 5", () => {
    expect(needsConfirmation("open_website", 4)).toBe(true);
    expect(needsConfirmation("open_website", 5)).toBe(false);
  });
});

describe("website allowlist", () => {
  it.each(["chatgpt", "openai", "claude", "anthropic", "metaai", "gemini", "instagram", "pubgmobile", "genshin", "steam"])("accepts popular destination %s", id => expect(validateWebsite(id).ok).toBe(true));
  it("validates every official destination", () => {
    for (const site of APPROVED_SITES) expect(validateWebsite(site.url).ok).toBe(true);
  });
  it("rejects provider lookalikes", () => expect(validateWebsite("https://claude.ai.evil.com").ok).toBe(false));
  it("does not trust arbitrary new-provider subdomains", () => expect(validateWebsite("https://unknown.chatgpt.com").ok).toBe(false));
  it("rejects embedded credentials", () => expect(validateWebsite("https://person:password@chatgpt.com").ok).toBe(false));
  it("rejects nonstandard ports", () => expect(validateWebsite("https://chatgpt.com:8765").ok).toBe(false));
  it("accepts approved ids", () => expect(validateWebsite("youtube")).toEqual({ ok: true, url: "https://www.youtube.com" }));
  it("accepts subpages of approved hosts", () => expect(validateWebsite("https://github.com/x").ok).toBe(true));
  it("rejects unapproved hosts", () => expect(validateWebsite("https://evil.com").ok).toBe(false));
  it("rejects lookalike hosts", () => expect(validateWebsite("https://github.com.evil.com").ok).toBe(false));
  it("rejects javascript: urls", () => expect(validateWebsite("javascript:alert(1)").ok).toBe(false));
  it("rejects plain http", () => expect(validateWebsite("http://google.com").ok).toBe(false));
});

describe("safe calculator", () => {
  it("respects precedence", () => expect(safeCalculate("2+3*4")).toEqual({ ok: true, value: 14 }));
  it("refuses code", () => expect(safeCalculate("process.exit()").ok).toBe(false));
  it("refuses division by zero result", () => expect(safeCalculate("1/0").ok).toBe(false));
});

describe("PC helper rules", () => {
  it("launching apps always asks even at level 5", () => expect(needsConfirmation("launch_app", 5)).toBe(true));
  it("writing files always asks, even at level 5", () => expect(needsConfirmation("write_file", 5)).toBe(true));
  it("screenshots always ask", () => expect(needsConfirmation("take_screenshot", 5)).toBe(true));
  it("launching apps needs level 4", () => expect(isToolAllowed("launch_app", 3)).toBe(false));
  it("blocks paths escaping the workspace", () => {
    expect(isSafeWorkspacePath("../x.txt")).toBe(false);
    expect(isSafeWorkspacePath("C:/Windows/win.ini")).toBe(false);
    expect(isSafeWorkspacePath("a\\..\\..\\x")).toBe(false);
    expect(isSafeWorkspacePath("notes/todo.txt")).toBe(true);
  });
});

describe("Google rules", () => {
  it("creating calendar events always asks", () => expect(needsConfirmation("create_event", 5)).toBe(true));
  it("sending messages (drafts) always asks", () => expect(needsConfirmation("draft_message", 5)).toBe(true));
  it("reading email needs level 3", () => expect(isToolAllowed("search_email", 2)).toBe(false));
});

describe("screen control and search", () => {
  it("screen click always asks, even at level 5", () => expect(needsConfirmation("screen_click", 5)).toBe(true));
  it("screen typing always asks, even at level 5", () => expect(needsConfirmation("screen_type", 5)).toBe(true));
  it("screen control is blocked below level 4", () => expect(isToolAllowed("screen_click", 3)).toBe(false));
  it("web search is available from level 2", () => expect(isToolAllowed("web_search", 2)).toBe(true));
  it("typing rejects control characters", () => expect(validateScreenText("hi\u001b[A").ok).toBe(false));
  it("typing rejects over 500 chars", () => expect(validateScreenText("a".repeat(501)).ok).toBe(false));
  it("typing accepts plain text with newlines", () => expect(validateScreenText("hello\nworld").ok).toBe(true));
});

import { GOOGLE_TOOLS as G } from "@/lib/jarvis/policy";
import { describe as d2, it as i2, expect as e2 } from "vitest";
d2("owner-only Google tools", () => {
  i2("other users cannot inherit the owner's connections at level 5", () => {
    e2(toolsForAccount(5, false)).not.toContain("search_email");
    e2(toolsForAccount(5, false)).not.toContain("read_email");
    e2(toolsForAccount(5, false)).not.toContain("list_events");
    e2(toolsForAccount(5, false)).not.toContain("create_event");
  });
  i2("owner retains connected Google tools", () => e2(toolsForAccount(5, true)).toEqual(e2.arrayContaining(G)));
  i2("covers every Gmail and Calendar tool", () => {
    e2([...G].sort()).toEqual(["create_event", "list_events", "read_email", "search_email"]);
  });
});
