import { describe, expect, it } from "vitest";
import { buildOpenCommand } from "../src/lib/util/open.js";

describe("buildOpenCommand", () => {
  it("uses open on darwin", () => {
    expect(buildOpenCommand("/tmp/file", "darwin")).toEqual({
      command: "open",
      args: ["/tmp/file"]
    });
  });

  it("uses cmd start on win32", () => {
    expect(buildOpenCommand("C:\\temp\\file", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "C:\\temp\\file"]
    });
  });

  it("uses xdg-open on other platforms", () => {
    expect(buildOpenCommand("/tmp/file", "linux")).toEqual({
      command: "xdg-open",
      args: ["/tmp/file"]
    });
  });
});
