import { describe, expect, it } from "vitest";
import { buildMcpHostConfigSnippet } from "../src/lib/integration/mcp-config.js";

describe("mcp host config snippets", () => {
  it("keeps Codex-only guidance while exposing workflow contract snippets for manual hosts", () => {
    const projectRoot = "/tmp/cam-project";

    const codexSnippet = buildMcpHostConfigSnippet("codex", projectRoot);
    const claudeSnippet = buildMcpHostConfigSnippet("claude", projectRoot);
    const geminiSnippet = buildMcpHostConfigSnippet("gemini", projectRoot);
    const genericSnippet = buildMcpHostConfigSnippet("generic", projectRoot);

    expect(codexSnippet.workflowContract).toMatchObject({
      recommendedPreset: "state=auto, limit=8"
    });
    expect(codexSnippet.readOnlyRetrieval).toBe(true);

    expect(claudeSnippet.readOnlyRetrieval).toBe(true);
    expect(claudeSnippet.workflowContract).toMatchObject({
      recommendedPreset: "state=auto, limit=8"
    });
    expect(claudeSnippet.agentsGuidance).toBeUndefined();
    expect(claudeSnippet.experimentalHooks).toBeUndefined();

    expect(geminiSnippet.readOnlyRetrieval).toBe(true);
    expect(geminiSnippet.workflowContract).toMatchObject({
      recommendedPreset: "state=auto, limit=8"
    });
    expect(geminiSnippet.agentsGuidance).toBeUndefined();
    expect(geminiSnippet.experimentalHooks).toBeUndefined();

    expect(genericSnippet.readOnlyRetrieval).toBe(true);
    expect(genericSnippet.workflowContract).toMatchObject({
      recommendedPreset: "state=auto, limit=8"
    });
    expect(genericSnippet.agentsGuidance).toBeUndefined();
    expect(genericSnippet.experimentalHooks).toBeUndefined();
  });
});
