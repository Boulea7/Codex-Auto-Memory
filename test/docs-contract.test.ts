import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

describe("docs contract", () => {
  it("keeps the public reviewer command surface and deterministic verification entry points documented", async () => {
    const readme = await readDoc("README.md");
    const readmeEn = await readDoc("README.en.md");
    const releaseChecklist = await readDoc("docs/release-checklist.md");
    const contributing = await readDoc("CONTRIBUTING.md");

    expect(readme).toContain("cam memory");
    expect(readme).toContain("cam session status");
    expect(readme).toContain("cam session refresh");
    expect(readme).toContain("reviewer warning prose");
    expect(readmeEn).toContain("cam memory");
    expect(readmeEn).toContain("cam session status");
    expect(readmeEn).toContain("confidence");
    expect(readmeEn).toContain("deterministic scrub");
    expect(releaseChecklist).toContain("pnpm exec tsx src/cli.ts audit");
    expect(releaseChecklist).toContain("pnpm test:docs-contract");
    expect(releaseChecklist).toContain("pnpm test:reviewer-smoke");
    expect(releaseChecklist).toContain("pnpm test:cli-smoke");
    expect(releaseChecklist).toContain("pnpm pack:check");
    expect(releaseChecklist).toContain("pnpm exec tsx src/cli.ts session refresh --json");
    expect(releaseChecklist).toContain("pnpm exec tsx src/cli.ts session load --json");
    expect(releaseChecklist).toContain("pnpm exec tsx src/cli.ts session status --json");
    expect(contributing).toContain("reviewer-only warnings");
    expect(contributing).toContain("pnpm test:docs-contract");
  });

  it("keeps continuity, architecture, and migration wording aligned with the current product posture", async () => {
    const continuityDoc = await readDoc("docs/session-continuity.md");
    const nativeMigrationDoc = await readDoc("docs/native-migration.md");
    const architecture = await readDoc("docs/architecture.md");
    const architectureEn = await readDoc("docs/architecture.en.md");
    const readme = await readDoc("README.md");
    const readmeEn = await readDoc("README.en.md");

    expect(continuityDoc).toContain("save` keeps merge semantics");
    expect(continuityDoc).toContain("refresh` ignores existing continuity");
    expect(continuityDoc).toContain("pending continuity recovery marker");
    expect(continuityDoc).toContain("**not** written into the continuity Markdown files themselves");
    expect(continuityDoc).toContain("reviewer/debug data belongs in an audit surface");
    expect(nativeMigrationDoc).toContain("companion-first");
    expect(nativeMigrationDoc).toContain("trusted primary path");
    expect(architecture).toContain("reviewer warning / confidence 属于 audit side metadata");
    expect(architecture).toContain("startup provenance 只列出这次注入时真实读取到的 continuity 文件");
    expect(architectureEn).toContain("reviewer warnings and confidence remain audit-side metadata");
    expect(architectureEn).toContain("startup provenance only lists continuity files that were actually read");
    expect(readme).toContain("companion-first");
    expect(readmeEn).toContain("companion-first");
  });
});
