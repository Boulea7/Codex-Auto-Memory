import { describe, expect, it } from "vitest";
import { buildCompactHistoryPreview } from "../src/lib/domain/reviewer-history.js";

describe("buildCompactHistoryPreview", () => {
  it("coalesces only consecutive entries with the same signature", () => {
    const preview = buildCompactHistoryPreview(
      [
        { id: "a-1", signature: "a" },
        { id: "a-2", signature: "a" },
        { id: "b-1", signature: "b" },
        { id: "a-3", signature: "a" }
      ],
      {
        getSignature: (entry) => entry.signature
      }
    );

    expect(preview.groups).toEqual([
      { latest: { id: "a-1", signature: "a" }, rawCount: 2 },
      { latest: { id: "b-1", signature: "b" }, rawCount: 1 },
      { latest: { id: "a-3", signature: "a" }, rawCount: 1 }
    ]);
    expect(preview.omittedRawCount).toBe(0);
    expect(preview.totalRawCount).toBe(4);
  });

  it("can exclude the latest entry before building compact preview groups", () => {
    const preview = buildCompactHistoryPreview(
      [
        { id: "latest", signature: "latest" },
        { id: "older-1", signature: "older" },
        { id: "older-2", signature: "older" }
      ],
      {
        excludeLeadingCount: 1,
        getSignature: (entry) => entry.signature
      }
    );

    expect(preview.groups).toEqual([
      { latest: { id: "older-1", signature: "older" }, rawCount: 2 }
    ]);
    expect(preview.omittedRawCount).toBe(0);
    expect(preview.totalRawCount).toBe(2);
  });

  it("tracks omitted raw entries after group limiting", () => {
    const preview = buildCompactHistoryPreview(
      [
        { id: "a-1", signature: "a" },
        { id: "a-2", signature: "a" },
        { id: "b-1", signature: "b" },
        { id: "c-1", signature: "c" }
      ],
      {
        maxGroups: 2,
        getSignature: (entry) => entry.signature
      }
    );

    expect(preview.groups).toEqual([
      { latest: { id: "a-1", signature: "a" }, rawCount: 2 },
      { latest: { id: "b-1", signature: "b" }, rawCount: 1 }
    ]);
    expect(preview.omittedRawCount).toBe(1);
    expect(preview.totalRawCount).toBe(4);
  });
});
