import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAuditScan } from "../src/lib/security/audit.js";
import { runAudit } from "../src/lib/commands/audit.js";
import { runCommandCapture } from "../src/lib/util/process.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(repoDir: string): Promise<void> {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Codex Auto Memory",
    GIT_AUTHOR_EMAIL: "cam@example.com",
    GIT_COMMITTER_NAME: "Codex Auto Memory",
    GIT_COMMITTER_EMAIL: "cam@example.com"
  };
  runCommandCapture("git", ["init", "-b", "main"], repoDir, gitEnv);
  await fs.writeFile(path.join(repoDir, ".gitignore"), ".claude/\n", "utf8");
  runCommandCapture("git", ["add", ".gitignore"], repoDir, gitEnv);
  runCommandCapture("git", ["commit", "-m", "init"], repoDir, gitEnv);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("audit scan", () => {
  it("classifies synthetic fixtures, local paths, and history matches", async () => {
    const repoDir = await tempDir("cam-audit-repo-");
    await initRepo(repoDir);

    const syntheticToken = `Bearer ${["sk", "EXAMPLE", "TOKEN", "123456789012"].join("-")}`;
    const syntheticAwsKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    await fs.mkdir(path.join(repoDir, "test"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "test", "fixture.test.ts"),
      [
        `const value = ${JSON.stringify(syntheticToken)}; // synthetic fixture`,
        `const aws = ${JSON.stringify(syntheticAwsKey)}; // synthetic fixture`
      ].join("\n") + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(repoDir, "README.md"),
      [
        "Uses ~/.codex-auto-memory/ for local storage.",
        "The regex covers Linux `/home/` and Windows `C:\\Users\\` path roots."
      ].join("\n") + "\n",
      "utf8"
    );
    runCommandCapture("git", ["add", "README.md", "test/fixture.test.ts"], repoDir, {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex Auto Memory",
      GIT_AUTHOR_EMAIL: "cam@example.com",
      GIT_COMMITTER_NAME: "Codex Auto Memory",
      GIT_COMMITTER_EMAIL: "cam@example.com"
    });
    runCommandCapture("git", ["commit", "-m", "fixtures"], repoDir, {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex Auto Memory",
      GIT_AUTHOR_EMAIL: "cam@example.com",
      GIT_COMMITTER_NAME: "Codex Auto Memory",
      GIT_COMMITTER_EMAIL: "cam@example.com"
    });

    const report = await runAuditScan({
      cwd: repoDir,
      includeHistory: true
    });

    expect(report.findings.some((finding) => finding.classification === "synthetic-test-fixture")).toBe(
      true
    );
    expect(report.findings.some((finding) => finding.classification === "generic-local-path")).toBe(
      true
    );
    expect(report.findings.some((finding) => finding.sourceType === "git-history")).toBe(true);
    expect(report.findings.some((finding) => finding.ruleId === "absolute-user-path")).toBe(false);
  }, 15_000);

  it("supports no-history mode from the command surface", async () => {
    const repoDir = await tempDir("cam-audit-no-history-");
    await initRepo(repoDir);
    await fs.writeFile(
      path.join(repoDir, "README.md"),
      "Storage lives under ~/.codex-auto-memory/.\n",
      "utf8"
    );
    runCommandCapture("git", ["add", "README.md"], repoDir, {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex Auto Memory",
      GIT_AUTHOR_EMAIL: "cam@example.com",
      GIT_COMMITTER_NAME: "Codex Auto Memory",
      GIT_COMMITTER_EMAIL: "cam@example.com"
    });
    runCommandCapture("git", ["commit", "-m", "readme"], repoDir, {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex Auto Memory",
      GIT_AUTHOR_EMAIL: "cam@example.com",
      GIT_COMMITTER_NAME: "Codex Auto Memory",
      GIT_COMMITTER_EMAIL: "cam@example.com"
    });

    const output = await runAudit({
      cwd: repoDir,
      noHistory: true
    });

    expect(output).toContain("History scan: disabled");
    expect(output).toContain("generic-local-path");
  });

  it("returns stable severity counts from the json command surface", async () => {
    const repoDir = await tempDir("cam-audit-json-");
    await initRepo(repoDir);
    await fs.writeFile(
      path.join(repoDir, "README.md"),
      "Storage lives under ~/.codex-auto-memory/.\n",
      "utf8"
    );

    const output = JSON.parse(
      await runAudit({
        cwd: repoDir,
        json: true,
        noHistory: true
      })
    ) as {
      findings: Array<{ severity: string; classification: string; location: string }>;
      summary: {
        bySeverity: {
          high: number;
          medium: number;
          low: number;
          info: number;
        };
      };
    };

    expect(output.summary.bySeverity.high).toBe(0);
    expect(output.summary.bySeverity.medium).toBe(0);
    const localPathFinding = output.findings.find(
      (finding) => finding.severity === "info" && finding.classification === "generic-local-path"
    );
    expect(localPathFinding).toBeDefined();
    expect(localPathFinding?.location.length).toBeGreaterThan(0);
  });
});
