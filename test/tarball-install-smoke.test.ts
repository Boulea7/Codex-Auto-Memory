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

    const sessionStatusResult = runCommandCapture(
      camBinaryPath(installDir),
      ["session", "status", "--json"],
      installDir,
      env
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
  }, 60_000);
});
