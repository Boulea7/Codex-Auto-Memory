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
    const ciWorkflow = await readDoc(".github/workflows/ci.yml");
    const releaseWorkflow = await readDoc(".github/workflows/release.yml");
    const packageJson = JSON.parse(await readDoc("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(readme).toContain("cam memory");
    expect(readme).toContain("cam session status");
    expect(readme).toContain("cam session refresh");
    expect(readme).toContain("reviewer warning prose");
    expect(readme).toContain("tagged GitHub Releases");
    expect(readme).toContain("tarball install smoke");
    expect(readmeEn).toContain("cam memory");
    expect(readmeEn).toContain("cam session status");
    expect(readmeEn).toContain("confidence");
    expect(readmeEn).toContain("deterministic scrub");
    expect(readmeEn).toContain("tagged GitHub Releases");
    expect(readmeEn).toContain("tarball install smoke");
    expect(releaseChecklist).toContain("pnpm test:dist-cli-smoke");
    expect(releaseChecklist).toContain("pnpm test:tarball-install-smoke");
    expect(releaseChecklist).toContain("node dist/cli.js --version");
    expect(releaseChecklist).toContain("node dist/cli.js audit");
    expect(releaseChecklist).toContain("pnpm test:docs-contract");
    expect(releaseChecklist).toContain("pnpm test:reviewer-smoke");
    expect(releaseChecklist).toContain("pnpm test:cli-smoke");
    expect(releaseChecklist).toContain("pnpm pack:check");
    expect(releaseChecklist).toContain("node dist/cli.js session refresh --json");
    expect(releaseChecklist).toContain("node dist/cli.js session load --json");
    expect(releaseChecklist).toContain("node dist/cli.js session status --json");
    expect(contributing).toContain("reviewer-only warnings");
    expect(contributing).toContain("pnpm test:docs-contract");
    expect(contributing).toContain("pnpm test:dist-cli-smoke");
    expect(contributing).toContain("pnpm test:tarball-install-smoke");
    expect(packageJson.scripts["test:dist-cli-smoke"]).toBe("vitest run test/dist-cli-smoke.test.ts");
    expect(packageJson.scripts["test:tarball-install-smoke"]).toBe(
      "vitest run test/tarball-install-smoke.test.ts"
    );
    expect(packageJson.scripts.prepack).toBe("pnpm build");
    expect(packageJson.scripts["verify:release"]).toContain("pnpm test:dist-cli-smoke");
    expect(packageJson.scripts["verify:release"]).toContain("pnpm test:tarball-install-smoke");
    expect(ciWorkflow).toContain("Dist CLI Smoke");
    expect(ciWorkflow).toContain("Tarball Install Smoke");
    expect(releaseWorkflow).toContain("tags:");
    expect(releaseWorkflow).toContain("v*");
    expect(releaseWorkflow).toContain("pnpm verify:release");
    expect(releaseWorkflow).toContain("gh release create");
    expect(releaseChecklist).toContain("default branch");
    expect(readme).toContain("确认默认分支上的该 workflow 已激活且可观测");
    expect(readmeEn).toContain("default branch exposes and activates that workflow");
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
