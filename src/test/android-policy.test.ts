import { describe, expect, it } from "vitest";
import { ANDROID_TOOLS, isToolAllowed, needsConfirmation, toolsForAccount } from "@/lib/jarvis/policy";

describe("Android task safety", () => {
  it.each(ANDROID_TOOLS)("%s is blocked below action level", tool => {
    expect(isToolAllowed(tool, 3)).toBe(false);
    expect(isToolAllowed(tool, 4)).toBe(true);
  });
  it.each(ANDROID_TOOLS)("%s always requires approval", tool => {
    expect(needsConfirmation(tool, 4)).toBe(true);
    expect(needsConfirmation(tool, 5)).toBe(true);
  });
  it("Android support never grants access to developer Google connections", () => {
    const allowed = toolsForAccount(5, false);
    expect(allowed).toContain("android_open_app");
    expect(allowed).not.toContain("search_email");
    expect(allowed).not.toContain("read_email");
    expect(allowed).not.toContain("create_event");
    expect(allowed).not.toContain("list_events");
  });
});