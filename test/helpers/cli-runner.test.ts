import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createIsolatedCliEnv,
  joinPathEntries,
  minimalCommandPath
} from "./cli-runner.js";

describe("cli runner helpers", () => {
  it("joins PATH entries with the current platform delimiter", () => {
    expect(joinPathEntries("alpha", "", "beta")).toBe(`alpha${path.delimiter}beta`);
  });

  it("isolates the CLI home directory for the current platform", () => {
    const env = createIsolatedCliEnv("/tmp/cam-home", {
      CAM_TEST_FLAG: "1"
    });

    expect(env.CAM_TEST_FLAG).toBe("1");
    expect(env.HOME).toBe("/tmp/cam-home");

    if (process.platform === "win32") {
      expect(env.USERPROFILE).toBe("/tmp/cam-home");
    }
  });

  it("strips inherited npm config noise from isolated CLI environments", () => {
    const env = createIsolatedCliEnv("/tmp/cam-home", {
      npm_config_verify_deps_before_run: "true",
      NPM_CONFIG__JSR_REGISTRY: "https://example.invalid"
    });

    expect(env.npm_config_verify_deps_before_run).toBeUndefined();
    expect(env.NPM_CONFIG__JSR_REGISTRY).toBeUndefined();
  });

  it("builds a minimal command PATH that keeps the current platform delimiter contract", () => {
    const entries = minimalCommandPath().split(path.delimiter).filter(Boolean);

    expect(entries[0]).toBe(path.dirname(process.execPath));
    if (process.platform !== "win32") {
      expect(entries).toEqual(expect.arrayContaining(["/usr/bin", "/bin"]));
    }
  });
});
