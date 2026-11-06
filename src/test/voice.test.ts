import { describe, expect, it } from "vitest";
import { buildTranscript } from "@/lib/jarvis/voice";

describe("buildTranscript", () => {
  it("collapses Android-style cumulative repeats", () => {
    expect(buildTranscript(["I", "I am", "I am man"])).toBe("I am man");
  });
  it("keeps normal separate segments", () => {
    expect(buildTranscript(["I am man", "open calendar"])).toBe("I am man open calendar");
  });
  it("drops an interim repeat of the final text", () => {
    expect(buildTranscript(["I am man"], "man")).toBe("I am man");
  });
});
