import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

interface PackageJsonContract {
  description: string;
  bin: {
    cam: string;
  };
  files: string[];
  scripts: Record<string, string>;
  publishConfig?: {
    access?: string;
  };
}

async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

const execFile = promisify(execFileCallback);

describe("docs contract", () => {
  it("keeps the public landing pages, docs hubs, and release entry points aligned", async () => {
    const readme = await readDoc("README.md");
    const readmeTw = await readDoc("README.zh-TW.md");
    const readmeEn = await readDoc("README.en.md");
    const readmeJa = await readDoc("README.ja.md");
    const docsReadme = await readDoc("docs/README.md");
    const docsReadmeEn = await readDoc("docs/README.en.md");
    const docsReadmeJa = await readDoc("docs/README.ja.md");
    const docsReadmeTw = await readDoc("docs/README.zh-TW.md");
    const support = await readDoc("SUPPORT.md");
    const security = await readDoc("SECURITY.md");
    const codeOfConduct = await readDoc("CODE_OF_CONDUCT.md");
    const changelog = await readDoc("CHANGELOG.md");
    const license = await readDoc("LICENSE");
    const issueConfig = await readDoc(".github/ISSUE_TEMPLATE/config.yml");
    const ciWorkflow = await readDoc(".github/workflows/ci.yml");
    const releaseWorkflow = await readDoc(".github/workflows/release.yml");
    const releaseChecklist = await readDoc("docs/release-checklist.md");
    const packageJson = JSON.parse(await readDoc("package.json")) as PackageJsonContract;
    const issueChooserUrl = "https://github.com/Boulea7/Codex-Auto-Memory/issues/new/choose";

    for (const landing of [readme, readmeTw, readmeEn, readmeJa]) {
      expect(landing).toContain("Node 20+");
      expect(landing).toContain("cam run");
      expect(landing).toContain("cam memory");
      expect(landing).toContain("cam recall search");
      expect(landing).toContain("cam session status");
      expect(landing).toContain("npm install --global ./codex-auto-memory-<version>.tgz");
      expect(landing).toContain("npm install --global codex-auto-memory");
      expect(landing).toContain("SUPPORT.md");
      expect(landing).toContain("SECURITY.md");
      expect(landing).toContain("CODE_OF_CONDUCT.md");
      expect(landing).toContain(issueChooserUrl);
    }

    expect(readme).toContain("源码安装");
    expect(readme).toContain("GitHub Release tarball");
    expect(readme).not.toContain("这轮 `0.1.1`");
    expect(readme.indexOf("npm install --global ./codex-auto-memory-<version>.tgz")).toBeLessThan(
      readme.indexOf("pnpm install")
    );
    expect(readmeEn).not.toContain("0.1.1 release readiness");
    expect(readmeEn).not.toContain("not publicly available on npm yet");
    expect(readmeEn).toContain("GitHub Release tarball");
    expect(readmeEn).toContain("[Documentation hub (English)](./docs/README.en.md)");
    expect(readmeJa).not.toContain("今回の `0.1.1`");
    expect(readmeJa).toContain("[ドキュメントハブ（日本語）](./docs/README.ja.md)");
    expect(readmeTw).not.toContain("這輪 `0.1.1`");
    expect(readmeTw).toContain("[文件中心（繁體中文）](./docs/README.zh-TW.md)");

    for (const docsHub of [docsReadme, docsReadmeEn, docsReadmeJa, docsReadmeTw]) {
      expect(docsHub).toContain("SUPPORT.md");
      expect(docsHub).toContain("SECURITY.md");
      expect(docsHub).toContain("CODE_OF_CONDUCT.md");
      expect(docsHub).toContain(issueChooserUrl);
    }

    expect(docsReadme).toContain("从这里开始");
    expect(docsReadmeEn).toContain("Start here");
    expect(docsReadmeEn).toContain("English docs hub");
    expect(docsReadmeJa).toContain("Language availability");
    expect(docsReadmeJa).toContain("日本語 docs hub");
    expect(docsReadmeTw).toContain("從這裡開始");
    expect(docsReadmeTw).toContain("繁體中文 docs hub");

    expect(support).toContain("README.md");
    expect(support).toContain("SECURITY.md");
    expect(support).toContain(issueChooserUrl);
    expect(support).toContain("opensource@lnzai.com");
    expect(security).toContain("private vulnerability");
    expect(security).toContain("opensource@lnzai.com");
    expect(codeOfConduct).toContain("Expected behavior");
    expect(codeOfConduct).toContain("SUPPORT.md");
    expect(changelog).toContain("# Changelog");
    expect(changelog).toContain("## 0.1.1");
    expect(license).toContain("APPENDIX: How to apply the Apache License to your work.");
    expect(issueConfig).toContain("blank_issues_enabled: false");
    expect(issueConfig).toContain("Security Policy");
    expect(issueConfig).toContain("Code of Conduct");

    expect(packageJson.description).toContain("Markdown-first");
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
        "CHANGELOG.md",
        "SUPPORT.md",
        "SECURITY.md",
        "CODE_OF_CONDUCT.md",
        "LICENSE"
      ])
    );
    expect(packageJson.publishConfig?.access).toBe("public");
    expect(packageJson.scripts["pack:check"]).toContain(".tmp/npm-cache");
    expect(packageJson.scripts["pack:release"]).toContain(".release-artifacts");
    expect(packageJson.scripts["pack:release"]).toContain(".tmp/npm-cache");
    expect(packageJson.scripts["test:coverage"]).toContain("--coverage");
    expect(packageJson.scripts["test:dist-cli-smoke:only"]).toContain("test/dist-cli-smoke.test.ts");
    expect(packageJson.scripts["verify:smoke-release"]).toContain("pnpm test:tarball-install-smoke");
    expect(packageJson.scripts["verify:ci"]).toContain("pnpm test:coverage");

    expect(ciWorkflow).toContain("node: [22, 24]");
    expect(ciWorkflow).toContain("macos-latest");
    expect(ciWorkflow).toContain("windows-latest");
    expect(ciWorkflow).toContain("Install Smoke");
    expect(ciWorkflow).toContain("pnpm test:tarball-install-smoke");
    expect(ciWorkflow).toContain("pnpm verify:ci");
    expect(releaseWorkflow).toContain("Preflight npm release");
    expect(releaseWorkflow).toContain("npm whoami");
    expect(releaseWorkflow).not.toContain("Detect npm publish availability");
    expect(releaseWorkflow).toContain("tarball_path=");
    expect(releaseWorkflow).toContain(
      'npm publish --provenance --access public "${{ steps.pack.outputs.tarball_path }}"'
    );
    expect(releaseWorkflow).toContain(
      'gh release create "${GITHUB_REF_NAME}" "${{ steps.pack.outputs.tarball_path }}"'
    );
    expect(releaseChecklist).toContain("GitHub Actions `NPM_TOKEN` secret");
    expect(releaseChecklist).toContain("manual fallback");
    expect(releaseChecklist).not.toContain("Until `codex-auto-memory` is publicly available on npm");
    expect(releaseChecklist).not.toContain(
      "If `NPM_TOKEN` is absent, the workflow should still complete the GitHub Release path"
    );
  });

  it("keeps architecture and continuity docs aligned with the current product posture", async () => {
    const continuityDoc = await readDoc("docs/session-continuity.md");
    const nativeMigrationDoc = await readDoc("docs/native-migration.md");
    const nativeMigrationEn = await readDoc("docs/native-migration.en.md");
    const architecture = await readDoc("docs/architecture.md");
    const architectureEn = await readDoc("docs/architecture.en.md");
    const integrationStrategy = await readDoc("docs/integration-strategy.md");
    const hostSurfaces = await readDoc("docs/host-surfaces.md");
    const contributing = await readDoc("CONTRIBUTING.md");
    const registerCommands = await readDoc("src/lib/cli/register-commands.ts");

    expect(continuityDoc).toContain("save` keeps merge semantics");
    expect(continuityDoc).toContain("refresh` ignores existing continuity");
    expect(continuityDoc).toContain("reviewer/debug data belongs in an audit surface");

    expect(nativeMigrationDoc).toContain("companion-first");
    expect(nativeMigrationEn).toContain("native Codex memory and hooks are still not ready");

    expect(architecture).toContain("cam recall");
    expect(architecture).toContain("cam mcp serve");
    expect(architecture).toContain("cam integrations install --host codex");
    expect(architectureEn).toContain("cam mcp serve");
    expect(architectureEn).toContain("state=auto, limit=8");

    expect(integrationStrategy).toContain("hook / skill / MCP");
    expect(integrationStrategy).toContain("memory-recall.sh");
    expect(integrationStrategy).toContain("manual-only");
    expect(hostSurfaces).toContain("cam integrations doctor");
    expect(hostSurfaces).toContain("read-only retrieval surface");

    expect(contributing).toContain("pnpm test:docs-contract");
    expect(contributing).toContain("pnpm test:dist-cli-smoke");
    expect(contributing).not.toContain("bilingual public-doc setup");
    expect(registerCommands).toContain("Manage the local bridge / fallback helper bundle");
    expect(registerCommands).toContain("Start Codex through the wrapper");
  });

  it("keeps local-only guidance files out of tracked repository state", async () => {
    const { stdout } = await execFile("git", [
      "ls-files",
      "AGENTS.md",
      "CLAUDE.md",
      "CLAUDE.local.md",
      "AI_REVIEW.local.md",
      "docs/progress-log.md",
      "docs/review-guide.md",
      "docs/reviewer-handoff.md",
      "docs/next-phase-brief.md",
      "docs/claude-reference.md",
      "docs/claude-reference.en.md",
      "docs/claudecode-memory-dream-migration.md",
      "docs/claudecode-patch-audit.md",
      "docs/host-integration-claude-gemini.md"
    ]);

    expect(stdout.trim()).toBe("");
  });
});
