import os from "node:os";
import path from "node:path";
import { ensureDir, writeTextFile } from "../util/fs.js";

function hookDir(): string {
  return path.join(os.homedir(), ".codex-auto-memory", "hooks");
}

export async function installHooks(): Promise<string> {
  const dir = hookDir();
  await ensureDir(dir);

  const postSessionPath = path.join(dir, "post-session-sync.sh");
  const startupPath = path.join(dir, "startup-doctor.sh");

  await writeTextFile(
    postSessionPath,
    "#!/bin/sh\n# Sync the latest rollout for the current project.\ncam sync \"$@\"\n"
  );
  await writeTextFile(
    startupPath,
    "#!/bin/sh\n# Print diagnostic information at session start.\ncam doctor \"$@\"\n"
  );

  return [
    `Generated hook bridge assets in ${dir}`,
    `- ${startupPath}`,
    `- ${postSessionPath}`,
    "",
    "These files are companion hook targets for future Codex native hooks integration."
  ].join("\n");
}

export async function removeHooks(): Promise<string> {
  const dir = hookDir();
  return `Hook bridge assets live under ${dir}. Remove the directory manually if you no longer need them.`;
}

