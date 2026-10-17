import { describe, expect, it } from "vitest";
import { isToolAllowed, needsConfirmation, safeCalculate, toolsForLevel, validateWebsite } from "@/lib/jarvis/policy";

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
