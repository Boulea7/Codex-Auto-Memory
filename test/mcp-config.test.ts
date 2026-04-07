import { describe, expect, it } from "vitest";
import { buildMcpHostConfigSnippet } from "../src/lib/integration/mcp-config.js";

describe("mcp host config snippets", () => {
  it("keeps workflowContract codex-only while preserving read-only snippets for manual hosts", () => {
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
    expect(claudeSnippet.workflowContract).toBeUndefined();

    expect(geminiSnippet.readOnlyRetrieval).toBe(true);
    expect(geminiSnippet.workflowContract).toBeUndefined();

    expect(genericSnippet.readOnlyRetrieval).toBe(true);
    expect(genericSnippet.workflowContract).toBeUndefined();
  });
});
