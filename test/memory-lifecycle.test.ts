import { describe, expect, it } from "vitest";
import { assertValidMemoryRef, parseMemoryRef } from "../src/lib/domain/memory-lifecycle.js";

describe("memory-lifecycle", () => {
  it("rejects refs with an empty trailing id segment", () => {
    expect(parseMemoryRef("project:active:workflow:")).toBeNull();
    expect(() => assertValidMemoryRef("project:active:workflow:")).toThrow(/Invalid memory ref/);
  });

  it("keeps multi-segment ids when the final segment is non-empty", () => {
    expect(parseMemoryRef("project:active:workflow:topic:entry")).toMatchObject({
      topic: "workflow",
      id: "topic:entry"
    });
  });
});
