import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../util/fs.js";
import type { ConfigScope } from "../types.js";
import { configPaths } from "./load-config.js";
import type { RawProjectConfig } from "./schema.js";

function configPathForScope(projectRoot: string, scope: ConfigScope): string {
  switch (scope) {
    case "user":
      return configPaths.getUserConfigPath();
    case "project":
      return configPaths.getProjectConfigPath(projectRoot);
    case "local":
      return configPaths.getLocalConfigPath(projectRoot);
  }
}

export async function patchConfigFile(
  projectRoot: string,
  scope: ConfigScope,
  patch: Partial<RawProjectConfig>
): Promise<string> {
  const filePath = configPathForScope(projectRoot, scope);
  await ensureDir(path.dirname(filePath));
  const current = (await readJsonFile<RawProjectConfig>(filePath)) ?? {};
  await writeJsonFile(filePath, {
    ...current,
    ...patch
  });
  return filePath;
}
