import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommandCapture } from "../src/lib/util/process.js";

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function camBinaryPath(installDir: string): string {
  return path.join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "cam.cmd" : "cam"
  );
}

function isolatedEnv(homeDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: homeDir,
    ...(process.platform === "win32" ? { USERPROFILE: homeDir } : {})
  };
}

describe("tarball install smoke", () => {
  it("installs and runs the packaged cam bin shim from a local tarball", async () => {
    const homeDir = await tempDir("cam-tarball-home-");
    const packDir = await tempDir("cam-tarball-pack-");
    const installDir = await tempDir("cam-tarball-install-");
    const env = isolatedEnv(homeDir);
    const packageJson = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")) as {
      version: string;
    };

    const packResult = runCommandCapture(
      npmCommand(),
      ["pack", "--pack-destination", packDir],
      process.cwd(),
      env
    );
    expect(packResult.exitCode).toBe(0);

    const tarballName = packResult.stdout.trim().split(/\r?\n/).at(-1);
    expect(tarballName).toBeTruthy();
    const tarballPath = path.join(packDir, tarballName!);

    const initResult = runCommandCapture(npmCommand(), ["init", "-y"], installDir, env);
    expect(initResult.exitCode).toBe(0);

    const installResult = runCommandCapture(
      npmCommand(),
      ["install", "--no-package-lock", tarballPath],
      installDir,
      env
    );
    expect(installResult.exitCode).toBe(0);

    const versionResult = runCommandCapture(camBinaryPath(installDir), ["--version"], installDir, env);
    expect(versionResult.exitCode).toBe(0);
    expect(versionResult.stdout.trim()).toBe(packageJson.version);

    const envWithBin = {
      ...env,
      PATH: `${path.join(installDir, "node_modules", ".bin")}${path.delimiter}${env.PATH ?? ""}`
    };

    const sessionStatusResult = runCommandCapture(
      camBinaryPath(installDir),
      ["session", "status", "--json"],
      installDir,
      envWithBin
    );
    expect(sessionStatusResult.exitCode).toBe(0);

    const payload = JSON.parse(sessionStatusResult.stdout) as {
      projectLocation: { exists: boolean };
      latestContinuityAuditEntry: object | null;
      pendingContinuityRecovery: object | null;
    };
    expect(payload.projectLocation.exists).toBe(false);
    expect(payload.latestContinuityAuditEntry).toBeNull();
    expect(payload.pendingContinuityRecovery).toBeNull();

    const mcpInstallResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "install", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(mcpInstallResult.exitCode).toBe(0);
    expect(JSON.parse(mcpInstallResult.stdout)).toMatchObject({
      host: "codex",
      action: "created",
      readOnlyRetrieval: true
    });
    expect(
      await fs.readFile(path.join(installDir, ".codex", "config.toml"), "utf8")
    ).toContain("[mcp_servers.codex_auto_memory]");

    const codexPrintConfigResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(codexPrintConfigResult.exitCode).toBe(0);
    expect(JSON.parse(codexPrintConfigResult.stdout)).toMatchObject({
      host: "codex",
      serverName: "codex_auto_memory",
      targetFileHint: ".codex/config.toml",
      agentsGuidance: {
        targetFileHint: "AGENTS.md",
        snippetFormat: "markdown"
      }
    });
    const codexPrintConfigPayload = JSON.parse(codexPrintConfigResult.stdout) as {
      agentsGuidance: { snippet: string };
    };
    const applyGuidanceResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "apply-guidance", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(applyGuidanceResult.exitCode).toBe(0);
    expect(JSON.parse(applyGuidanceResult.stdout)).toMatchObject({
      host: "codex",
      action: "created",
      managedBlockVersion: "codex-agents-guidance-v1"
    });
    expect(
      await fs.readFile(path.join(installDir, "AGENTS.md"), "utf8")
    ).toContain(codexPrintConfigPayload.agentsGuidance.snippet);

    const claudePrintConfigResult = runCommandCapture(
      camBinaryPath(installDir),
      ["mcp", "print-config", "--host", "claude", "--json"],
      installDir,
      envWithBin
    );
    expect(claudePrintConfigResult.exitCode).toBe(0);
    expect(JSON.parse(claudePrintConfigResult.stdout)).toMatchObject({
      host: "claude",
      serverName: "codex_auto_memory",
      targetFileHint: ".mcp.json"
    });

    const hooksResult = runCommandCapture(
      camBinaryPath(installDir),
      ["hooks", "install"],
      installDir,
      envWithBin
    );
    expect(hooksResult.exitCode).toBe(0);
    expect(
      await fs.readFile(path.join(homeDir, ".codex-auto-memory", "hooks", "memory-recall.sh"), "utf8")
    ).toContain("cam:asset-version");

    const skillsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install"],
      installDir,
      envWithBin
    );
    expect(skillsResult.exitCode).toBe(0);
    expect(
      await fs.readFile(
        path.join(homeDir, ".codex", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");

    const officialSkillsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["skills", "install", "--surface", "official-user"],
      installDir,
      envWithBin
    );
    expect(officialSkillsResult.exitCode).toBe(0);
    expect(
      await fs.readFile(
        path.join(homeDir, ".agents", "skills", "codex-auto-memory-recall", "SKILL.md"),
        "utf8"
      )
    ).toContain("cam:asset-version");

    const integrationsResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "install", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(integrationsResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsResult.stdout)).toMatchObject({
      host: "codex",
      stackAction: "unchanged",
      skillsSurface: "runtime",
      readOnlyRetrieval: true,
      subactions: {
        mcp: { action: "unchanged" },
        hooks: { action: "unchanged" },
        skills: { action: "unchanged", surface: "runtime" }
      }
    });

    const integrationsApplyResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "apply", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(integrationsApplyResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsApplyResult.stdout)).toMatchObject({
      host: "codex",
      stackAction: "unchanged",
      skillsSurface: "runtime",
      readOnlyRetrieval: true,
      subactions: {
        mcp: { action: "unchanged" },
        agents: { action: "unchanged" },
        hooks: { action: "unchanged" },
        skills: { action: "unchanged", surface: "runtime" }
      }
    });

    const integrationsDoctorResult = runCommandCapture(
      camBinaryPath(installDir),
      ["integrations", "doctor", "--host", "codex", "--json"],
      installDir,
      envWithBin
    );
    expect(integrationsDoctorResult.exitCode).toBe(0);
    expect(JSON.parse(integrationsDoctorResult.stdout)).toMatchObject({
      host: "codex",
      readOnlyRetrieval: true,
      status: "ok",
      recommendedRoute: "mcp",
      recommendedPreset: "state=auto, limit=8",
      preferredSkillSurface: "runtime",
      recommendedSkillInstallCommand: "cam skills install --surface runtime",
      installedSkillSurfaces: ["runtime", "official-user"],
      readySkillSurfaces: ["runtime", "official-user"],
      subchecks: {
        mcp: { status: "ok" },
        agents: { status: "ok" },
        hookCapture: { status: "ok" },
        hookRecall: { status: "ok" },
        skill: { status: "ok" },
        workflowConsistency: { status: "ok" }
      }
    });
  }, 60_000);
});
