import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectContext } from "../src/lib/domain/project-context.js";
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

describe("detectProjectContext", () => {
  it("shares project ids across worktrees while keeping worktree ids distinct", async () => {
    const repoDir = await tempDir("cam-repo-");
    const worktreeDir = path.join(await tempDir("cam-wt-root-"), "wt");
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex Auto Memory",
      GIT_AUTHOR_EMAIL: "cam@example.com",
      GIT_COMMITTER_NAME: "Codex Auto Memory",
      GIT_COMMITTER_EMAIL: "cam@example.com"
    };

    runCommandCapture("git", ["init", "-b", "main"], repoDir, gitEnv);
    await fs.writeFile(path.join(repoDir, "README.md"), "seed\n", "utf8");
    runCommandCapture("git", ["add", "README.md"], repoDir, gitEnv);
    runCommandCapture("git", ["commit", "-m", "init"], repoDir, gitEnv);
    runCommandCapture("git", ["worktree", "add", "-b", "feature", worktreeDir], repoDir, gitEnv);

    const mainContext = detectProjectContext(repoDir);
    const linkedContext = detectProjectContext(worktreeDir);

    expect(mainContext.projectId).toBe(linkedContext.projectId);
    expect(mainContext.worktreeId).not.toBe(linkedContext.worktreeId);
    expect(mainContext.gitCommonDir).toBe(linkedContext.gitCommonDir);
  });
});

