export interface ParsedCodexFeature {
  name: string;
  stage: string;
  enabled: boolean;
}

export interface NativeReadinessReport {
  memories: ParsedCodexFeature | null;
  hooks: ParsedCodexFeature | null;
  summary: string;
}

export function parseCodexFeatures(output: string): ParsedCodexFeature[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-z0-9_]+)\s{2,}([a-z -]+?)\s{2,}(true|false)$/i);
      if (!match) {
        return null;
      }

      const [, name, stage, enabled] = match;
      if (!name || !stage || !enabled) {
        return null;
      }

      return {
        name,
        stage,
        enabled: enabled === "true"
      } satisfies ParsedCodexFeature;
    })
    .filter((feature): feature is ParsedCodexFeature => feature !== null);
}

export function buildNativeReadinessReport(
  features: ParsedCodexFeature[]
): NativeReadinessReport {
  const memories = features.find((feature) => feature.name === "memories") ?? null;
  const hooks = features.find((feature) => feature.name === "codex_hooks") ?? null;
  const appServer =
    features.find((feature) => feature.name === "tui") ??
    features.find((feature) => feature.name === "tui_app_server") ??
    null;

  if (!memories && !hooks) {
    return {
      memories,
      hooks,
      summary: "Codex feature output did not expose memories or codex_hooks."
    };
  }

  if (memories?.enabled && hooks?.enabled) {
    return {
      memories,
      hooks,
      summary: "Native feature flags are enabled, but migration should still wait for stable public docs and deterministic behavior."
    };
  }

  return {
    memories,
    hooks,
    summary: "Companion mode remains the primary path. Native migration should stay disabled until memories and codex_hooks are both stable and publicly documented."
  };
}
