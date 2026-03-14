import { describe, expect, it } from "vitest";
import {
  buildNativeReadinessReport,
  parseCodexFeatures
} from "../src/lib/runtime/codex-features.js";

describe("codex feature parsing", () => {
  it("parses feature rows and produces a conservative readiness summary", () => {
    const features = parseCodexFeatures(`
apply_patch_freeform             under development  true
codex_hooks                      under development  false
memories                         under development  false
shell_tool                       stable             true
`);

    expect(features.find((feature) => feature.name === "memories")?.enabled).toBe(false);
    expect(features.find((feature) => feature.name === "codex_hooks")?.stage).toBe(
      "under development"
    );

    const readiness = buildNativeReadinessReport(features);
    expect(readiness.summary).toContain("Companion mode remains the primary path");
  });

  it("reports a guarded status even when native feature flags are enabled", () => {
    const readiness = buildNativeReadinessReport([
      {
        name: "memories",
        stage: "experimental",
        enabled: true
      },
      {
        name: "codex_hooks",
        stage: "experimental",
        enabled: true
      }
    ]);

    expect(readiness.summary).toContain("Native feature flags are enabled");
  });
});
