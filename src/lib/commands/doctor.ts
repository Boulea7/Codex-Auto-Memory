import { runCommandCapture } from "../util/process.js";
import {
  filterUnsafeTopicDiagnostics,
  type RetrievalSidecarCheck,
  type TopicFileDiagnostic
} from "../domain/memory-store.js";
import { buildResolvedCliCommand } from "../integration/retrieval-contract.js";
import { buildNativeReadinessReport, parseCodexFeatures } from "../runtime/codex-features.js";
import { buildRuntimeContext } from "../runtime/runtime-context.js";

interface DoctorOptions {
  cwd?: string;
  json?: boolean;
}

type DoctorRecommendedRoute = "companion";

interface DoctorTopicDiagnostics {
  status: "ok" | "warning";
  summary: string;
  diagnostics: TopicFileDiagnostic[];
}

interface DoctorRetrievalSidecar {
  status: "ok" | "warning";
  summary: string;
  repairCommand: string;
  checks: RetrievalSidecarCheck[];
}

function buildDoctorTopicDiagnostics(diagnostics: TopicFileDiagnostic[]): DoctorTopicDiagnostics {
  return diagnostics.length === 0
    ? {
        status: "ok",
        summary: "No unsafe topic files were detected.",
        diagnostics
      }
    : {
        status: "warning",
        summary: `${diagnostics.length} unsafe topic file(s) were detected in the Markdown canonical store.`,
        diagnostics
      };
}

function buildDoctorRetrievalSidecar(
  checks: RetrievalSidecarCheck[],
  projectRoot: string
): DoctorRetrievalSidecar {
  const degradedChecks = checks.filter((check) => check.status !== "ok");
  const requestedScope =
    new Set(degradedChecks.map((check) => check.scope)).size === 1
      ? degradedChecks[0]?.scope ?? "all"
      : "all";
  const requestedState =
    new Set(degradedChecks.map((check) => check.state)).size === 1
      ? degradedChecks[0]?.state ?? "all"
      : "all";
  return {
    status: degradedChecks.length === 0 ? "ok" : "warning",
    summary:
      degradedChecks.length === 0
        ? "All inspected retrieval sidecars are current."
        : "One or more retrieval sidecars are missing, invalid, or stale. Recall still falls back to Markdown canonical memory safely.",
    repairCommand: buildResolvedCliCommand(
      `memory reindex --scope ${requestedScope} --state ${requestedState}`,
      {
        cwd: projectRoot
      }
    ),
    checks
  };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd, {}, {
    ensureMemoryLayout: false
  });
  const featureResult = runCommandCapture(
    runtime.loadedConfig.config.codexBinary,
    ["features", "list"],
    runtime.project.cwd
  );
  const parsedFeatures =
    featureResult.exitCode === 0 ? parseCodexFeatures(featureResult.stdout) : [];
  const readiness = buildNativeReadinessReport(parsedFeatures);
  const retrievalSidecar = buildDoctorRetrievalSidecar(
    await runtime.syncService.memoryStore.inspectRetrievalSidecars(),
    runtime.project.projectRoot
  );
  const topicDiagnostics = buildDoctorTopicDiagnostics(
    filterUnsafeTopicDiagnostics(
      await runtime.syncService.memoryStore.inspectTopicFiles({
        scope: "all",
        state: "all"
      })
    )
  );
  const layoutDiagnostics = await runtime.syncService.memoryStore.inspectLayoutDiagnostics({
    scope: "all",
    state: "all"
  });
  const recommendedRoute: DoctorRecommendedRoute = "companion";
  const recommendedActionCommand = buildResolvedCliCommand("mcp doctor --host codex", {
    cwd: runtime.project.projectRoot
  });
  const recommendedDoctorCommand = buildResolvedCliCommand("doctor --json", {
    cwd: runtime.project.projectRoot
  });
  const recommendedAction = [
    `Run ${recommendedActionCommand} to inspect the operational retrieval route for this project.`,
    retrievalSidecar.status === "warning"
      ? `If retrieval sidecars remain degraded after that review, rebuild them with ${retrievalSidecar.repairCommand}.`
      : null
  ]
    .filter((line): line is string => line !== null)
    .join(" ");

  if (options.json) {
    return JSON.stringify(
      {
        projectRoot: runtime.project.projectRoot,
        projectId: runtime.project.projectId,
        worktreeId: runtime.project.worktreeId,
        memoryRoot: runtime.syncService.memoryStore.paths.baseDir,
        autoMemoryEnabled: runtime.loadedConfig.config.autoMemoryEnabled,
        extractorMode: runtime.loadedConfig.config.extractorMode,
        configFiles: runtime.loadedConfig.files,
        warnings: runtime.loadedConfig.warnings,
        recommendedRoute,
        recommendedAction,
        recommendedActionCommand,
        recommendedDoctorCommand,
        retrievalSidecar,
        topicDiagnostics,
        layoutDiagnostics,
        features: parsedFeatures,
        readiness
      },
      null,
      2
    );
  }

  const lines = [
    "Codex Auto Memory Doctor",
    `Project root: ${runtime.project.projectRoot}`,
    `Project id: ${runtime.project.projectId}`,
    `Worktree id: ${runtime.project.worktreeId}`,
    `Memory root: ${runtime.syncService.memoryStore.paths.baseDir}`,
    `Auto memory enabled: ${runtime.loadedConfig.config.autoMemoryEnabled}`,
    `Extractor mode: ${runtime.loadedConfig.config.extractorMode}`,
    `Recommended route: ${recommendedRoute}`,
    `Recommended next step: ${recommendedAction}`,
    `Recommended next-step command: ${recommendedActionCommand}`,
    `Recommended doctor command: ${recommendedDoctorCommand}`,
    `Retrieval sidecar: ${retrievalSidecar.status} (${retrievalSidecar.summary})`,
    `Topic diagnostics: ${topicDiagnostics.status} (${topicDiagnostics.summary})`,
    `Layout diagnostics: ${layoutDiagnostics.length === 0 ? "none" : layoutDiagnostics.length}`,
    `Companion session source: rollout-jsonl`,
    `Companion runtime injector: wrapper-base-instructions`,
    `Config files: ${runtime.loadedConfig.files.length ? runtime.loadedConfig.files.join(", ") : "none"}`,
    ...runtime.loadedConfig.warnings.map((warning) => `Warning: ${warning}`),
    "",
    "Native memory/hooks readiness:",
    `- memories: ${readiness.memories ? `${readiness.memories.stage}/${readiness.memories.enabled}` : "missing"}`,
    `- codex_hooks: ${readiness.hooks ? `${readiness.hooks.stage}/${readiness.hooks.enabled}` : "missing"}`,
    `- summary: ${readiness.summary}`,
    "",
    "Host/UI signals:",
    `- Codex App Server: ${readiness.appServer ? `${readiness.appServer.stage}/${readiness.appServer.enabled}` : "missing"}`,
    ...(retrievalSidecar.status === "warning"
      ? [
          "",
          "Retrieval sidecar diagnostics:",
          `- Repair command: ${retrievalSidecar.repairCommand}`,
          ...retrievalSidecar.checks.map(
            (check) =>
              `- ${check.scope}/${check.state}: ${check.status}${check.fallbackReason ? ` (${check.fallbackReason})` : ""} | index: ${check.indexPath} | generatedAt: ${check.generatedAt ?? "none"}`
          )
        ]
      : []),
    ...(topicDiagnostics.status === "warning"
      ? [
          "",
          "Topic diagnostics:",
          ...topicDiagnostics.diagnostics.map(
            (diagnostic) =>
              `- ${diagnostic.scope}/${diagnostic.state}/${diagnostic.topic}: unsafe (${diagnostic.unsafeReason ?? "unknown reason"}) | entries=${diagnostic.entryCount} | malformed=${diagnostic.invalidEntryBlockCount} | manualContent=${diagnostic.manualContentDetected ? "yes" : "no"}`
          )
        ]
      : []),
    ...(layoutDiagnostics.length > 0
      ? [
          "",
          "Layout diagnostics:",
          ...layoutDiagnostics.map(
            (diagnostic) =>
              `- ${diagnostic.scope}/${diagnostic.state}/${diagnostic.fileName}: ${diagnostic.kind}`
          )
        ]
      : []),
    "",
    "Codex feature flags:",
    featureResult.exitCode === 0
      ? featureResult.stdout.trim()
        : `Unable to inspect feature flags: ${featureResult.stderr.trim() || "unknown error"}`
  ];

  return lines.join("\n");
}
