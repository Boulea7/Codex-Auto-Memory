import { describe, expect, it } from "vitest";
import {
  hasExpectedExecutableState,
  shouldCheckExecutableBit
} from "../src/lib/integration/install-assets.js";

describe("integration install asset executable checks", () => {
  it("skips executable bit checks on Windows", () => {
    expect(shouldCheckExecutableBit("win32")).toBe(false);
    expect(hasExpectedExecutableState(true, 0o644, "win32")).toBe(true);
  });

  it("requires executable bits on POSIX platforms when expected", () => {
    expect(shouldCheckExecutableBit("linux")).toBe(true);
    expect(hasExpectedExecutableState(true, 0o755, "linux")).toBe(true);
    expect(hasExpectedExecutableState(true, 0o644, "linux")).toBe(false);
  });

  it("treats non-executable assets as satisfied on every platform", () => {
    expect(hasExpectedExecutableState(false, 0o644, "linux")).toBe(true);
    expect(hasExpectedExecutableState(false, 0o644, "win32")).toBe(true);
  });
});
