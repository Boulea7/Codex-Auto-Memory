import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface PackageJsonContract {
  description: string;
  bin: {
    cam: string;
  };
  files: string[];
  scripts: Record<string, string>;
}

async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

describe("docs contract", () => {
  it("keeps the public reviewer command surface and deterministic verification entry points documented", async () => {
    const readme = await readDoc("README.md");
    const readmeTw = await readDoc("README.zh-TW.md");
    const readmeEn = await readDoc("README.en.md");
    const readmeJa = await readDoc("README.ja.md");
    const docsReadme = await readDoc("docs/README.md");
    const docsReadmeEn = await readDoc("docs/README.en.md");
    const claudeReference = await readDoc("docs/claude-reference.md");
    const claudeReferenceEn = await readDoc("docs/claude-reference.en.md");
    const nativeMigrationEn = await readDoc("docs/native-migration.en.md");
    const releaseChecklist = await readDoc("docs/release-checklist.md");
    const contributing = await readDoc("CONTRIBUTING.md");
    const ciWorkflow = await readDoc(".github/workflows/ci.yml");
    const releaseWorkflow = await readDoc(".github/workflows/release.yml");
    const packageJson = JSON.parse(await readDoc("package.json")) as PackageJsonContract;

    expect(readme).toContain("cam memory");
    expect(readme).toContain("cam session status");
    expect(readme).toContain("cam session refresh");
    expect(readme).toContain("cam recall search");
    expect(readme).toContain("--state auto");
    expect(readme).toContain("当前主任务");
    expect(readme).toContain("suppressed conflict candidates");
    expect(readme).toContain("cam mcp install --host codex");
    expect(readme).toContain("cam hooks install");
    expect(readme).toContain("cam integrations install --host codex");
    expect(readme).toContain("cam integrations apply --host codex");
    expect(readme).toContain("cam integrations doctor --host codex");
    expect(readme).toContain("memory-recall.sh");
    expect(readme).toContain("limit=8");
    expect(readme).toContain("local bridge");
    expect(readme).toContain("cam mcp apply-guidance --host codex");
    expect(readme).toContain("cam skills install");
    expect(readme).toContain("--surface runtime|official-user|official-project");
    expect(readme).toContain("cam mcp serve");
    expect(readme).toContain("cam mcp print-config --host codex");
    expect(readme).toContain("AGENTS.md");
    expect(readme).toContain("cam mcp doctor");
    expect(readme).toContain("manual-only");
    expect(readme).toContain("cam forget \"old debug note\" --archive");
    expect(readme).toContain("README.zh-TW.md");
    expect(readme).toContain("README.ja.md");
    expect(readme).toContain("集成演进策略");
    expect(readme).toContain("宿主能力面");
    expect(readmeTw).toContain("README.md");
    expect(readmeTw).toContain("README.en.md");
    expect(readmeTw).toContain("memory-recall.sh");
    expect(readmeTw).toContain("cam integrations install --host codex");
    expect(readmeTw).toContain("cam integrations apply --host codex");
    expect(readmeTw).toContain("cam integrations doctor --host codex");
    expect(readmeTw).toContain("limit=8");
    expect(readmeTw).toContain("cam mcp install --host codex");
    expect(readmeTw).toContain("cam mcp print-config --host codex");
    expect(readmeTw).toContain("cam mcp apply-guidance --host codex");
    expect(readmeTw).toContain("cam mcp doctor");
    expect(readmeTw).toContain("--state auto");
    expect(readmeTw).toContain("local bridge");
    expect(readmeTw).toContain("manual-only");
    expect(readmeTw).toContain("--surface runtime|official-user|official-project");
    expect(readmeTw).toContain("重要 `--help` 文案");
    expect(readmeTw).toContain("release-facing public contract");
    expect(readmeJa).toContain("README.md");
    expect(readmeJa).toContain("README.en.md");
    expect(readmeJa).toContain("memory-recall.sh");
    expect(readmeJa).toContain("cam integrations install --host codex");
    expect(readmeJa).toContain("cam integrations apply --host codex");
    expect(readmeJa).toContain("cam integrations doctor --host codex");
    expect(readmeJa).toContain("limit=8");
    expect(readmeJa).toContain("cam mcp install --host codex");
    expect(readmeJa).toContain("cam mcp print-config --host codex");
    expect(readmeJa).toContain("cam mcp apply-guidance --host codex");
    expect(readmeJa).toContain("cam mcp doctor");
    expect(readmeJa).toContain("--state auto");
    expect(readmeJa).toContain("local bridge");
    expect(readmeJa).toContain("manual-only");
    expect(readmeJa).toContain("--surface runtime|official-user|official-project");
    expect(readmeJa).toContain("主要な `--help` 文言");
    expect(readmeJa).toContain("release-facing public contract");
    expect(readmeEn).toContain("cam memory");
    expect(readmeEn).toContain("cam session status");
    expect(readmeEn).toContain("cam recall search");
    expect(readmeEn).toContain("--state auto");
    expect(readmeEn).toContain("confidence");
    expect(readmeEn).toContain("suppressed conflict candidates");
    expect(readmeEn).toContain("wrapper-driven companion layer");
    expect(readmeEn).toContain("cam mcp install --host codex");
    expect(readmeEn).toContain("README.zh-TW.md");
    expect(readmeEn).toContain("README.ja.md");
    expect(readmeEn).toContain("hook, skill, and MCP-aware");
    expect(readmeEn).toContain("cam hooks");
    expect(readmeEn).toContain("cam integrations install --host codex");
    expect(readmeEn).toContain("cam integrations apply --host codex");
    expect(readmeEn).toContain("cam integrations doctor --host codex");
    expect(readmeEn).toContain("cam skills");
    expect(readmeEn).toContain("memory-recall.sh");
    expect(readmeEn).toContain("limit=8");
    expect(readmeEn).toContain("local bridge");
    expect(readmeEn).toContain("cam mcp apply-guidance --host codex");
    expect(readmeEn).toContain("cam mcp serve");
    expect(readmeEn).toContain("cam mcp print-config --host codex");
    expect(readmeEn).toContain("AGENTS.md");
    expect(readmeEn).toContain("cam mcp doctor");
    expect(readmeEn).toContain("manual-only");
    expect(readmeEn).toContain("--surface runtime|official-user|official-project");
    expect(docsReadme).toContain("Codex-first Hybrid");
    expect(docsReadme).toContain("cam mcp apply-guidance --host codex");
    expect(docsReadme).toContain("cam integrations apply --host codex");
    expect(docsReadme).toContain("cam integrations doctor --host codex");
    expect(docsReadme).toContain("runtime|official-user|official-project");
    expect(docsReadme).toContain("manual-only");
    expect(docsReadme).toContain("`--help` 文案");
    expect(docsReadme).toContain("state=auto");
    expect(docsReadmeEn).toContain("Codex-first Hybrid");
    expect(docsReadmeEn).toContain("cam mcp apply-guidance --host codex");
    expect(docsReadmeEn).toContain("cam integrations apply --host codex");
    expect(docsReadmeEn).toContain("cam integrations doctor --host codex");
    expect(docsReadmeEn).toContain("runtime`, `official-user`, and `official-project");
    expect(docsReadmeEn).toContain("manual-only");
    expect(docsReadmeEn).toContain("`--help` text is part of the release-facing public contract");
    expect(docsReadmeEn).toContain("state=auto, limit=8");
    expect(claudeReference).toContain("autoMemoryDirectory");
    expect(claudeReference).toContain("共享项目劫持用户 memory 路径");
    expect(claudeReferenceEn).toContain("autoMemoryDirectory");
    expect(claudeReferenceEn).toContain("shared project config");
    expect(claudeReferenceEn).toContain("user-level memory path");
    expect(nativeMigrationEn).toContain("native Codex memory and hooks are still not ready");
    expect(nativeMigrationEn).toContain("allow non-native integration expansion");
    expect(releaseChecklist).toContain("pnpm test:dist-cli-smoke");
    expect(releaseChecklist).toContain("pnpm test:tarball-install-smoke");
    expect(releaseChecklist).toContain("node dist/cli.js --version");
    expect(releaseChecklist).toContain("node dist/cli.js audit");
    expect(releaseChecklist).toContain("pnpm test:docs-contract");
    expect(releaseChecklist).toContain("pnpm test:reviewer-smoke");
    expect(releaseChecklist).toContain("pnpm test:cli-smoke");
    expect(releaseChecklist).toContain("pnpm pack:check");
    expect(releaseChecklist).toContain("package.json.files");
    expect(releaseChecklist).toContain("node dist/cli.js session refresh --json");
    expect(releaseChecklist).toContain("node dist/cli.js session load --json");
    expect(releaseChecklist).toContain("node dist/cli.js session status --json");
    expect(releaseChecklist).toContain("node dist/cli.js recall search pnpm --json");
    expect(releaseChecklist).toContain("state=auto, limit=8");
    expect(releaseChecklist).toContain("node dist/cli.js recall details <ref> --json");
    expect(releaseChecklist).toContain(
      "node dist/cli.js mcp install --host <codex|claude|gemini> --json"
    );
    expect(releaseChecklist).toContain('action: "unchanged"');
    expect(releaseChecklist).toContain("node dist/cli.js mcp install --host generic");
    expect(releaseChecklist).toContain(
      "node dist/cli.js mcp print-config --host <codex|claude|gemini|generic> --json"
    );
    expect(releaseChecklist).toContain("AGENTS.md snippet");
    expect(releaseChecklist).toContain("node dist/cli.js mcp apply-guidance --host codex --json");
    expect(releaseChecklist).toContain("node dist/cli.js mcp doctor --json");
    expect(releaseChecklist).toContain("node dist/cli.js integrations install --host codex --json");
    expect(releaseChecklist).toContain("node dist/cli.js integrations apply --host codex --json");
    expect(releaseChecklist).toContain("node dist/cli.js skills install --surface official-user");
    expect(releaseChecklist).toContain("node dist/cli.js integrations install --host codex --skill-surface official-user --json");
    expect(releaseChecklist).toContain("node dist/cli.js integrations apply --host codex --skill-surface official-user --json");
    expect(releaseChecklist).toContain("node dist/cli.js skills install --surface official-project");
    expect(releaseChecklist).toContain("node dist/cli.js integrations install --host codex --skill-surface official-project --json");
    expect(releaseChecklist).toContain("node dist/cli.js integrations apply --host codex --skill-surface official-project --json");
    expect(releaseChecklist).toContain("node dist/cli.js integrations doctor --host codex --json");
    expect(releaseChecklist).toContain("node dist/cli.js mcp install --help");
    expect(releaseChecklist).toContain("node dist/cli.js mcp print-config --help");
    expect(releaseChecklist).toContain("node dist/cli.js mcp apply-guidance --help");
    expect(releaseChecklist).toContain("node dist/cli.js mcp doctor --help");
    expect(releaseChecklist).toContain("node dist/cli.js skills install --help");
    expect(releaseChecklist).toContain("node dist/cli.js integrations install --help");
    expect(releaseChecklist).toContain("node dist/cli.js integrations apply --help");
    expect(releaseChecklist).toContain("node dist/cli.js integrations doctor --help");
    expect(releaseChecklist).toContain("node dist/cli.js skills install --surface official-project --cwd <path>");
    expect(releaseChecklist).toContain("node dist/cli.js mcp apply-guidance --host codex --cwd <path> --json");
    expect(releaseChecklist).toContain("node dist/cli.js integrations apply --host codex --cwd <path> --json");
    expect(releaseChecklist).toContain("codex, claude, gemini, or generic");
    expect(releaseChecklist).toContain("leaving `generic` out of the install branch");
    expect(releaseChecklist).toContain("README.zh-TW.md");
    expect(releaseChecklist).toContain("README.ja.md");
    expect(releaseChecklist).toContain("search_memories");
    expect(contributing).toContain("reviewer-only warnings");
    expect(contributing).toContain("pnpm test:docs-contract");
    expect(contributing).toContain("pnpm test:dist-cli-smoke");
    expect(contributing).toContain("pnpm test:tarball-install-smoke");
    expect(contributing).toContain("cam mcp apply-guidance");
    expect(contributing).toContain("cam integrations apply");
    expect(contributing).toContain("skill surface selection");
    expect(packageJson.scripts["test:cli-smoke"]).toContain("test/recall-command.test.ts");
    expect(packageJson.scripts["test:cli-smoke"]).toContain("test/hooks-command.test.ts");
    expect(packageJson.scripts["test:cli-smoke"]).toContain("test/integrations-command.test.ts");
    expect(packageJson.scripts["test:cli-smoke"]).toContain("test/mcp-command.test.ts");
    expect(packageJson.scripts["test:cli-smoke"]).toContain("test/skills-command.test.ts");
    expect(packageJson.scripts["test:reviewer-smoke"]).toContain("test/recall-command.test.ts");
    expect(packageJson.scripts["test:reviewer-smoke"]).toContain("test/hooks-command.test.ts");
    expect(packageJson.scripts["test:reviewer-smoke"]).toContain("test/integrations-command.test.ts");
    expect(packageJson.scripts["test:reviewer-smoke"]).toContain("test/mcp-command.test.ts");
    expect(packageJson.scripts["test:reviewer-smoke"]).toContain("test/skills-command.test.ts");
    expect(packageJson.scripts["test:dist-cli-smoke"]).toBe("vitest run test/dist-cli-smoke.test.ts");
    expect(packageJson.scripts["test:tarball-install-smoke"]).toBe(
      "vitest run test/tarball-install-smoke.test.ts"
    );
    expect(packageJson.description).toBe(
      "A Markdown-first, local-first memory runtime for Codex with wrapper, hook, MCP, skill, and AGENTS integration surfaces."
    );
    expect(packageJson.bin.cam).toBe("dist/cli.js");
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "dist",
        "docs",
        "schemas",
        "README.md",
        "README.zh-TW.md",
        "README.en.md",
        "README.ja.md",
        "LICENSE"
      ])
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
    expect(releaseChecklist).toContain("remote default branch exposes `release.yml` in Actions");
    expect(releaseChecklist).toContain("workflow is active");
  });

  it("keeps continuity, architecture, and migration wording aligned with the current product posture", async () => {
    const continuityDoc = await readDoc("docs/session-continuity.md");
    const nativeMigrationDoc = await readDoc("docs/native-migration.md");
    const architecture = await readDoc("docs/architecture.md");
    const architectureEn = await readDoc("docs/architecture.en.md");
    const integrationStrategy = await readDoc("docs/integration-strategy.md");
    const hostSurfaces = await readDoc("docs/host-surfaces.md");
    const readme = await readDoc("README.md");
    const readmeEn = await readDoc("README.en.md");

    expect(continuityDoc).toContain("save` keeps merge semantics");
    expect(continuityDoc).toContain("refresh` ignores existing continuity");
    expect(continuityDoc).toContain("pending continuity recovery marker");
    expect(continuityDoc).toContain("**not** written into the continuity Markdown files themselves");
    expect(continuityDoc).toContain("reviewer/debug data belongs in an audit surface");
    expect(continuityDoc).toContain("future integration surfaces should consume continuity");
    expect(nativeMigrationDoc).toContain("companion-first");
    expect(nativeMigrationDoc).toContain("trusted primary path");
    expect(nativeMigrationDoc).toContain("Codex-first Hybrid");
    expect(architecture).toContain("reviewer warning / confidence 属于 audit side metadata");
    expect(architecture).toContain("startup provenance 只列出真实读取到的 continuity 文件");
    expect(architecture).toContain("cam recall");
    expect(architecture).toContain("memory-recall.sh");
    expect(architecture).toContain("cam mcp serve");
    expect(architecture).toContain("cam mcp install");
    expect(architecture).toContain("--surface runtime|official-user|official-project");
    expect(architecture).toContain("manual-only");
    expect(architecture).toContain("cam mcp apply-guidance");
    expect(architecture).toContain("cam integrations install --host codex");
    expect(architecture).toContain("cam integrations apply --host codex");
    expect(architecture).toContain("cam integrations doctor --host codex");
    expect(architecture).toContain("state=auto");
    expect(architecture).toContain("local bridge / fallback recall bundle");
    expect(architecture).toContain("cam mcp print-config");
    expect(architecture).toContain("cam mcp doctor");
    expect(architecture).toContain("release-facing `--help` surfaces");
    expect(architecture).toContain("Codex-first Hybrid");
    expect(architectureEn).toContain("reviewer warnings and confidence remain audit-side metadata");
    expect(architectureEn).toContain("cam recall timeline");
    expect(architectureEn).toContain("cam mcp serve");
    expect(architectureEn).toContain("cam mcp install");
    expect(architectureEn).toContain("state=auto, limit=8");
    expect(architectureEn).toContain("local bridge assets");
    expect(architectureEn).toContain("cam mcp print-config");
    expect(architectureEn).toContain("cam mcp doctor");
    expect(architectureEn).toContain("memory-recall.sh");
    expect(architectureEn).toContain("continuity startup provenance only lists files actually used");
    expect(architectureEn).toContain("Codex-first Hybrid");
    expect(integrationStrategy).toContain("Codex-first Hybrid");
    expect(integrationStrategy).toContain("hook / skill / MCP");
    expect(integrationStrategy).toContain("cam recall");
    expect(integrationStrategy).toContain("state=auto");
    expect(integrationStrategy).toContain("limit=8");
    expect(integrationStrategy).toContain("cam mcp install");
    expect(integrationStrategy).toContain("cam mcp apply-guidance");
    expect(integrationStrategy).toContain("memory-recall.sh");
    expect(integrationStrategy).toContain("local bridge / fallback helper bundle");
    expect(integrationStrategy).toContain("cam mcp serve");
    expect(integrationStrategy).toContain("cam mcp print-config");
    expect(integrationStrategy).toContain("AGENTS.md");
    expect(integrationStrategy).toContain("cam mcp doctor");
    expect(integrationStrategy).toContain("manual-only");
    expect(integrationStrategy).toContain("cam integrations install --host codex");
    expect(integrationStrategy).toContain("cam integrations doctor --host codex");
    expect(integrationStrategy).toContain("release-facing `--help` 文案");
    expect(integrationStrategy).toContain("cam skills install");
    expect(integrationStrategy).toContain("--surface runtime|official-user|official-project");
    expect(hostSurfaces).toContain("Codex-first Hybrid memory system");
    expect(hostSurfaces).toContain("cam integrations install/apply --skill-surface");
    expect(hostSurfaces).toContain("cam recall");
    expect(hostSurfaces).toContain("cam hooks install");
    expect(hostSurfaces).toContain("local bridge");
    expect(hostSurfaces).toContain("read-only retrieval surface");
    expect(hostSurfaces).toContain("cam mcp install");
    expect(hostSurfaces).toContain("manual-only");
    expect(hostSurfaces).toContain("cam mcp apply-guidance");
    expect(hostSurfaces).toContain("AGENTS.md");
    expect(hostSurfaces).toContain("cam mcp doctor");
    expect(hostSurfaces).toContain("cam integrations install");
    expect(hostSurfaces).toContain("cam integrations doctor");
    expect(hostSurfaces).toContain("release-facing `--help` 文案");
    expect(readme).toContain("companion-first");
    expect(readmeEn).toContain("companion CLI");
    expect(readme).toContain("当前主任务");
    expect(readmeEn).toContain("Current priorities");
  });
});
