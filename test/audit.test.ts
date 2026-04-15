import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAuditScan } from "../src/lib/security/audit.js";
import { runAudit } from "../src/lib/commands/audit.js";
import { runCommandCapture } from "../src/lib/util/process.js";
import { sanitizePathFieldsDeep, sanitizePublicPath } from "../src/lib/util/public-paths.js";
import * as processUtils from "../src/lib/util/process.js";
import { runCli } from "./helpers/cli-runner.js";

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
  }, 30_000);

  it("supports no-history mode from the direct command helper", async () => {
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
    const explicitHistoryFalseOutput = await runAudit({
      cwd: repoDir,
      history: false
    });

    expect(output).toContain("History scan: disabled");
    expect(output).toContain("generic-local-path");
    expect(explicitHistoryFalseOutput).toContain("History scan: disabled");
  });

  it("respects --no-history on the real CLI surface and still supports --history", async () => {
    const repoDir = await tempDir("cam-audit-cli-history-");
    await initRepo(repoDir);
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex Auto Memory",
      GIT_AUTHOR_EMAIL: "cam@example.com",
      GIT_COMMITTER_NAME: "Codex Auto Memory",
      GIT_COMMITTER_EMAIL: "cam@example.com"
    };

    const historicalLocalPath = ["/Users", "alice/project/"].join("/");
    await fs.writeFile(
      path.join(repoDir, "README.md"),
      `Historical local path: ${historicalLocalPath}.\n`,
      "utf8"
    );
    runCommandCapture("git", ["add", "README.md"], repoDir, gitEnv);
    runCommandCapture("git", ["commit", "-m", "history-only-path"], repoDir, gitEnv);

    await fs.writeFile(path.join(repoDir, "README.md"), "Safe current contents.\n", "utf8");
    runCommandCapture("git", ["add", "README.md"], repoDir, gitEnv);
    runCommandCapture("git", ["commit", "-m", "cleanup"], repoDir, gitEnv);

    const noHistoryResult = runCli(repoDir, ["audit", "--json", "--no-history"]);
    const historyResult = runCli(repoDir, ["audit", "--json", "--history"]);
    const defaultResult = runCli(repoDir, ["audit", "--json"]);

    expect(noHistoryResult.exitCode).toBe(0);
    expect(historyResult.exitCode).toBe(0);
    expect(defaultResult.exitCode).toBe(0);

    const noHistoryJson = JSON.parse(noHistoryResult.stdout) as {
      findings: Array<{ sourceType: string; location: string }>;
      summary: { bySeverity: { medium: number } };
    };
    const historyJson = JSON.parse(historyResult.stdout) as {
      findings: Array<{ sourceType: string; location: string; classification: string; severity: string }>;
      summary: { bySeverity: { medium: number } };
    };
    const defaultJson = JSON.parse(defaultResult.stdout) as {
      findings: Array<{ sourceType: string; location: string }>;
      summary: { bySeverity: { medium: number } };
    };

    expect(noHistoryJson.findings.some((finding) => finding.sourceType === "git-history")).toBe(false);
    expect(noHistoryJson.summary.bySeverity.medium).toBe(0);
    expect(historyJson.findings.some((finding) => finding.sourceType === "git-history")).toBe(true);
    expect(
      historyJson.findings.some(
        (finding) =>
          finding.sourceType === "git-history" &&
          finding.classification === "manual-review-needed" &&
          finding.severity === "medium" &&
          finding.location.includes("README.md")
      )
    ).toBe(true);
    expect(historyJson.summary.bySeverity.medium).toBeGreaterThan(0);
    expect(defaultJson.findings.some((finding) => finding.sourceType === "git-history")).toBe(true);
    expect(defaultJson.summary.bySeverity.medium).toBeGreaterThan(0);
  });

  it("keeps the correct history line number when matched text contains colon-digit-colon", async () => {
    const repoDir = await tempDir("cam-audit-history-parse-");
    await initRepo(repoDir);
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex Auto Memory",
      GIT_AUTHOR_EMAIL: "cam@example.com",
      GIT_COMMITTER_NAME: "Codex Auto Memory",
      GIT_COMMITTER_EMAIL: "cam@example.com"
    };

    const historicalLocalPath = ["/Users", "alice/project/"].join("/");
    const historicalLine = [
      "Historical local path: ",
      historicalLocalPath,
      " with port:3000: note."
    ].join("");
    await fs.writeFile(path.join(repoDir, "README.md"), `${historicalLine}\n`, "utf8");
    runCommandCapture("git", ["add", "README.md"], repoDir, gitEnv);
    runCommandCapture("git", ["commit", "-m", "history-parse"], repoDir, gitEnv);

    await fs.writeFile(path.join(repoDir, "README.md"), "Safe current contents.\n", "utf8");
    runCommandCapture("git", ["add", "README.md"], repoDir, gitEnv);
    runCommandCapture("git", ["commit", "-m", "cleanup"], repoDir, gitEnv);

    const report = await runAuditScan({
      cwd: repoDir,
      includeHistory: true
    });
    const historyPathFinding = report.findings.find(
      (finding) =>
        finding.sourceType === "git-history" &&
        finding.ruleId === "absolute-user-path" &&
        finding.location.endsWith("README.md:1")
    );

    expect(historyPathFinding).toBeDefined();
    expect(historyPathFinding?.snippet).toContain("port:3000: note.");
  });

  it("falls back to the legacy history walk when git grep fails", async () => {
    const repoDir = await tempDir("cam-audit-history-fallback-");
    await initRepo(repoDir);
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex Auto Memory",
      GIT_AUTHOR_EMAIL: "cam@example.com",
      GIT_COMMITTER_NAME: "Codex Auto Memory",
      GIT_COMMITTER_EMAIL: "cam@example.com"
    };

    const historicalLocalPath = ["/Users", "alice/project/"].join("/");
    await fs.writeFile(
      path.join(repoDir, "README.md"),
      `Historical local path: ${historicalLocalPath}.\n`,
      "utf8"
    );
    runCommandCapture("git", ["add", "README.md"], repoDir, gitEnv);
    runCommandCapture("git", ["commit", "-m", "history-only-path"], repoDir, gitEnv);

    await fs.writeFile(path.join(repoDir, "README.md"), "Safe current contents.\n", "utf8");
    runCommandCapture("git", ["add", "README.md"], repoDir, gitEnv);
    runCommandCapture("git", ["commit", "-m", "cleanup"], repoDir, gitEnv);

    const originalRunCommandCapture = processUtils.runCommandCapture;
    const grepSpy = vi
      .spyOn(processUtils, "runCommandCapture")
      .mockImplementation((command, args, cwd, env, input) => {
        if (command === "git" && args[0] === "grep") {
          return {
            stdout: "",
            stderr: "simulated git grep failure",
            exitCode: 2
          };
        }

        return originalRunCommandCapture(command, args, cwd, env, input);
      });

    try {
      const report = await runAuditScan({
        cwd: repoDir,
        includeHistory: true
      });

      expect(report.findings.some((finding) => finding.sourceType === "git-history")).toBe(true);
      expect(
        report.findings.some(
          (finding) =>
            finding.sourceType === "git-history" &&
            finding.ruleId === "absolute-user-path" &&
            finding.location.endsWith("README.md:1")
        )
      ).toBe(true);
    } finally {
      grepSpy.mockRestore();
    }
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

  it("scans untracked non-ignored files for confirmed secrets in no-history mode", async () => {
    const repoDir = await tempDir("cam-audit-untracked-secret-");
    await initRepo(repoDir);

    await fs.writeFile(
      path.join(repoDir, ".env"),
      "OPENAI_API_KEY=sk-live-untrackedsecret1234567890\n",
      "utf8"
    );

    const report = await runAuditScan({
      cwd: repoDir,
      includeHistory: false
    });

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "working-tree",
          classification: "confirmed-risk",
          severity: "high",
          location: ".env:1",
          ruleId: "secret-like-token"
        })
      ])
    );
    expect(report.snippetPolicy).toBe("redacted");
    const secretFinding = report.findings.find(
      (finding) =>
        finding.sourceType === "working-tree" &&
        finding.classification === "confirmed-risk" &&
        finding.severity === "high" &&
        finding.location === ".env:1" &&
        finding.ruleId === "secret-like-token"
    );
    expect(secretFinding).toBeDefined();
    expect(secretFinding?.snippet).toContain("[redacted]");
    expect(secretFinding?.snippet).not.toContain("sk-live-untrackedsecret1234567890");
  });

  it("can opt into raw snippets when explicitly requested", async () => {
    const repoDir = await tempDir("cam-audit-raw-snippet-");
    await initRepo(repoDir);

    await fs.writeFile(
      path.join(repoDir, ".env"),
      "OPENAI_API_KEY=sk-live-rawsnippet1234567890\n",
      "utf8"
    );

    const report = await runAuditScan({
      cwd: repoDir,
      includeHistory: false,
      showSensitiveSnippets: true
    });

    expect(report.snippetPolicy).toBe("raw");
    const secretFinding = report.findings.find(
      (finding) =>
        finding.sourceType === "working-tree" &&
        finding.classification === "confirmed-risk" &&
        finding.severity === "high" &&
        finding.location === ".env:1" &&
        finding.ruleId === "secret-like-token"
    );
    expect(secretFinding).toBeDefined();
    expect(secretFinding?.snippet).toContain("sk-live-rawsnippet1234567890");
  });

  it("redacts synthetic secret-like snippets unless raw output is explicitly requested", async () => {
    const repoDir = await tempDir("cam-audit-synthetic-token-");
    await initRepo(repoDir);

    await fs.writeFile(
      path.join(repoDir, "README.md"),
      "Synthetic fixture token: Bearer synthetic-token-1234567890 fixture\n",
      "utf8"
    );

    const report = await runAuditScan({
      cwd: repoDir,
      includeHistory: false
    });

    const secretFinding = report.findings.find(
      (finding) =>
        finding.ruleId === "secret-like-token" &&
        finding.classification === "synthetic-test-fixture"
    );
    expect(secretFinding).toBeDefined();
    expect(secretFinding?.snippet).toContain("[redacted]");
    expect(secretFinding?.snippet).not.toContain("synthetic-token-1234567890");
  });

  it("redacts private key markers even for synthetic fixtures unless raw output is explicitly requested", async () => {
    const repoDir = await tempDir("cam-audit-private-key-");
    await initRepo(repoDir);

    await fs.writeFile(
      path.join(repoDir, "README.md"),
      "Synthetic fixture key marker: -----BEGIN RSA PRIVATE KEY----- fixture\n",
      "utf8"
    );

    const report = await runAuditScan({
      cwd: repoDir,
      includeHistory: false
    });

    const privateKeyFinding = report.findings.find(
      (finding) =>
        finding.ruleId === "private-key-marker" &&
        finding.classification === "synthetic-test-fixture"
    );
    expect(privateKeyFinding).toBeDefined();
    expect(privateKeyFinding?.snippet).toBe("[redacted private key marker]");
  });

  it("sanitizes nested object fields inside path collection arrays", () => {
    const projectRoot = path.join("/tmp", "cam-public-paths-project");
    const nestedPath = path.join(projectRoot, "docs", "AGENTS.md");
    const nestedRoot = path.join(projectRoot, "docs");

    const sanitized = sanitizePathFieldsDeep(
      {
        detectedTargets: [
          {
            path: nestedPath,
            nestedPaths: [nestedPath],
            metadata: {
              docsRoot: nestedRoot
            }
          }
        ]
      },
      { projectRoot }
    );

    expect(sanitized).toEqual({
      detectedTargets: [
        {
          path: path.join("<project-root>", "docs", "AGENTS.md"),
          nestedPaths: [path.join("<project-root>", "docs", "AGENTS.md")],
          metadata: {
            docsRoot: path.join("<project-root>", "docs")
          }
        }
      ]
    });
  });

  it("supports --cwd on the real CLI surface when scanning another repository", async () => {
    const callerDir = await tempDir("cam-audit-caller-");
    const repoDir = await tempDir("cam-audit-cwd-target-");
    await initRepo(repoDir);
    await fs.writeFile(
      path.join(repoDir, ".env"),
      "OPENAI_API_KEY=sk-live-crossrepo1234567890\n",
      "utf8"
    );

    const result = runCli(callerDir, ["audit", "--json", "--no-history", "--cwd", repoDir]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      cwd: sanitizePublicPath(repoDir, {
        extraRoots: [{ label: "<cwd>", path: repoDir }]
      }),
      findings: expect.arrayContaining([
        expect.objectContaining({
          location: ".env:1",
          ruleId: "secret-like-token",
          severity: "high",
          classification: "confirmed-risk"
        })
      ])
    });
  });
});
