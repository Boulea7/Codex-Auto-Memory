import { describe, expect, it } from "vitest";
import { buildWindowsCmdCommandLine, shouldUseWindowsShell } from "../src/lib/util/process.js";

describe("process util helpers", () => {
  it("uses a shell for Windows cmd wrappers", () => {
    expect(shouldUseWindowsShell("npm.cmd", "win32")).toBe(true);
    expect(shouldUseWindowsShell("pnpm.CMD", "win32")).toBe(true);
    expect(shouldUseWindowsShell("wrapper.bat", "win32")).toBe(true);
  });

  it("does not force a shell for non-wrapper commands or non-Windows platforms", () => {
    expect(shouldUseWindowsShell("node", "win32")).toBe(false);
    expect(shouldUseWindowsShell("cam", "darwin")).toBe(false);
    expect(shouldUseWindowsShell("/tmp/mock-codex", "linux")).toBe(false);
  });

  it("quotes Windows cmd wrapper invocations with space-containing arguments", () => {
    expect(
      buildWindowsCmdCommandLine("C:\\Program Files\\nodejs\\npm.cmd", [
        "install",
        "--cwd",
        "C:\\tmp\\project with spaces"
      ])
    ).toBe(
      '"C:\\Program Files\\nodejs\\npm.cmd" install --cwd "C:\\tmp\\project with spaces"'
    );
  });
});
