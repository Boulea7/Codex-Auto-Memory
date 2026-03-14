import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectContext } from "../types.js";
import { hashId } from "../util/text.js";
import { runCommandCapture } from "../util/process.js";

function safeRealPath(input: string): string {
  try {
    return fs.realpathSync.native(input);
  } catch {
    return path.resolve(input);
  }
}

function detectGitProject(cwd: string): ProjectContext | null {
  const rootResult = runCommandCapture("git", ["rev-parse", "--show-toplevel"], cwd);
  if (rootResult.exitCode !== 0) {
    return null;
  }

  const gitRoot = safeRealPath(rootResult.stdout.trim());
  const gitDirResult = runCommandCapture("git", ["rev-parse", "--absolute-git-dir"], cwd);
  const gitCommonDirResult = runCommandCapture("git", ["rev-parse", "--git-common-dir"], cwd);

  const gitDir = safeRealPath(gitDirResult.stdout.trim());
  const gitCommonDir = safeRealPath(path.resolve(cwd, gitCommonDirResult.stdout.trim()));
  const projectName = path.basename(path.dirname(gitCommonDir));

  return {
    cwd: safeRealPath(cwd),
    projectRoot: gitRoot,
    projectId: `${projectName}-${hashId(gitCommonDir)}`,
    worktreeId: `${path.basename(gitRoot)}-${hashId(gitDir)}`,
    gitRoot,
    gitDir,
    gitCommonDir
  };
}

export function detectProjectContext(cwd = process.cwd()): ProjectContext {
  const absoluteCwd = safeRealPath(cwd);
  const gitProject = detectGitProject(absoluteCwd);
  if (gitProject) {
    return gitProject;
  }

  return {
    cwd: absoluteCwd,
    projectRoot: absoluteCwd,
    projectId: `path-${hashId(absoluteCwd)}`,
    worktreeId: `path-${hashId(absoluteCwd)}`,
    gitRoot: undefined,
    gitDir: undefined,
    gitCommonDir: undefined
  };
}

export function getDefaultMemoryDirectory(): string {
  return path.join(os.homedir(), ".codex-auto-memory");
}
