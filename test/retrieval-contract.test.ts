import { describe, expect, it } from "vitest";
import { appendCliCwdFlag } from "../src/lib/integration/retrieval-contract.js";

describe("retrieval contract", () => {
  it("shell-quotes cwd values so the shell cannot expand them", () => {
    expect(appendCliCwdFlag("cam recall search \"<query>\"", "/tmp/$HOME/path with spaces")).toBe(
      "cam recall search \"<query>\" --cwd '/tmp/$HOME/path with spaces'"
    );
  });

  it("escapes embedded single quotes in cwd values", () => {
    expect(appendCliCwdFlag("cam recall details \"<ref>\"", "/tmp/it's-safe")).toBe(
      "cam recall details \"<ref>\" --cwd '/tmp/it'\"'\"'s-safe'"
    );
  });
});
