import os from "node:os";
import path from "node:path";

export const CODEX_MEMORY_SKILL_NAME = "codex-auto-memory-recall";
export const CODEX_SKILL_INSTALL_SURFACES = [
  "runtime",
  "official-user",
  "official-project"
] as const;

export type CodexSkillRuntimeSource = "CODEX_HOME" | "HOME_DOT_CODEX";
export type CodexSkillInstallSurface = (typeof CODEX_SKILL_INSTALL_SURFACES)[number];

export interface CodexSkillSurfacePath {
  surface: CodexSkillInstallSurface;
  dir: string;
}

export interface CodexSkillPathResolution {
  skillName: string;
  runtimeSource: CodexSkillRuntimeSource;
  runtimeBaseDir: string;
  runtimeSkillDir: string;
  runtimeAssetDir: string;
  officialUserSkillDir: string;
  officialProjectSkillDir: string;
  preferredInstallSurface: CodexSkillInstallSurface;
  availableSurfaces: CodexSkillSurfacePath[];
}

function resolveCodexHomeOverride(): string | null {
  const rawCodexHome = process.env.CODEX_HOME;
  if (!rawCodexHome) {
    return null;
  }

  const trimmedCodexHome = rawCodexHome.trim();
  if (trimmedCodexHome.length === 0) {
    return null;
  }

  if (!path.isAbsolute(trimmedCodexHome)) {
    throw new Error("CODEX_HOME must be an absolute path when set.");
  }

  return path.resolve(trimmedCodexHome);
}

export function normalizeCodexSkillInstallSurface(
  surface: string | undefined
): CodexSkillInstallSurface {
  if (!surface) {
    return "runtime";
  }

  if (
    (CODEX_SKILL_INSTALL_SURFACES as readonly string[]).includes(surface)
  ) {
    return surface as CodexSkillInstallSurface;
  }

  throw new Error(
    `Unsupported skill install surface "${surface}". Use runtime, official-user, or official-project.`
  );
}

export function formatCodexSkillInstallSurface(surface: CodexSkillInstallSurface): string {
  switch (surface) {
    case "runtime":
      return "runtime";
    case "official-user":
      return "official-user";
    case "official-project":
      return "official-project";
  }
}

export function buildCodexSkillInstallCommand(
  surface: CodexSkillInstallSurface = "runtime"
): string {
  return `cam skills install --surface ${surface}`;
}

export function resolveCodexSkillInstallDir(
  resolution: CodexSkillPathResolution,
  surface: CodexSkillInstallSurface = resolution.preferredInstallSurface
): string {
  switch (surface) {
    case "runtime":
      return resolution.runtimeAssetDir;
    case "official-user":
      return resolution.officialUserSkillDir;
    case "official-project":
      return resolution.officialProjectSkillDir;
  }
}

export function resolveCodexSkillPaths(
  projectRoot: string,
  homeDir = os.homedir()
): CodexSkillPathResolution {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const codexHomeOverride = resolveCodexHomeOverride();
  const runtimeSource: CodexSkillRuntimeSource = codexHomeOverride ? "CODEX_HOME" : "HOME_DOT_CODEX";
  const runtimeBaseDir = codexHomeOverride ?? path.join(homeDir, ".codex");
  const runtimeAssetDir = path.join(runtimeBaseDir, "skills", CODEX_MEMORY_SKILL_NAME);
  const officialUserSkillDir = path.join(homeDir, ".agents", "skills", CODEX_MEMORY_SKILL_NAME);
  const officialProjectSkillDir = path.join(
    resolvedProjectRoot,
    ".agents",
    "skills",
    CODEX_MEMORY_SKILL_NAME
  );

  return {
    skillName: CODEX_MEMORY_SKILL_NAME,
    runtimeSource,
    runtimeBaseDir,
    runtimeSkillDir: runtimeAssetDir,
    runtimeAssetDir,
    officialUserSkillDir,
    officialProjectSkillDir,
    preferredInstallSurface: "runtime",
    availableSurfaces: [
      {
        surface: "runtime",
        dir: runtimeAssetDir
      },
      {
        surface: "official-user",
        dir: officialUserSkillDir
      },
      {
        surface: "official-project",
        dir: officialProjectSkillDir
      }
    ]
  };
}
