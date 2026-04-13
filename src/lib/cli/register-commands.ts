import { Command, Option } from "commander";
import { runAudit } from "../commands/audit.js";
import { runDoctor } from "../commands/doctor.js";
import { runDream } from "../commands/dream.js";
import { runForget } from "../commands/forget.js";
import { installHooks, removeHooks } from "../commands/hooks.js";
import {
  runIntegrationsApply,
  runIntegrationsDoctor,
  runIntegrationsInstall
} from "../commands/integrations.js";
import { runInit } from "../commands/init.js";
import { runMemory, runMemoryReindex } from "../commands/memory.js";
import {
  runMcpApplyGuidance,
  runMcpDoctor,
  runMcpInstall,
  runMcpPrintConfig,
  runMcpServe
} from "../commands/mcp.js";
import { runRecall } from "../commands/recall.js";
import { runRemember } from "../commands/remember.js";
import { runSession } from "../commands/session.js";
import { installSkills, removeSkills } from "../commands/skills.js";
import { runSync } from "../commands/sync.js";
import {
  formatMcpHostChoices,
  SUPPORTED_MCP_DOCTOR_HOST_SELECTIONS,
  SUPPORTED_MCP_HOSTS,
  SUPPORTED_MCP_INSTALL_HOSTS
} from "../integration/mcp-hosts.js";
import {
  DEFAULT_CODEX_SKILL_INSTALL_SURFACE,
  formatCodexSkillInstallSurfaceChoices
} from "../integration/skills-paths.js";

type AsyncCommandHandler<Args extends unknown[]> = (...args: Args) => Promise<string>;
type MemoryReindexCommandOptions = NonNullable<Parameters<typeof runMemoryReindex>[0]>;

function withStdout<Args extends unknown[]>(
  handler: AsyncCommandHandler<Args>
): (...args: Args) => Promise<void> {
  return async (...args: Args): Promise<void> => {
    process.stdout.write(`${await handler(...args)}\n`);
  };
}

function addJsonOption(command: Command): Command {
  return command.option("--json", "Print JSON output");
}

function addSessionScopeOption(command: Command): Command {
  return command.option(
    "--scope <scope>",
    "Target continuity scope: project, project-local, or both",
    "both"
  );
}

function addSessionRolloutOption(command: Command): Command {
  return command.option("--rollout <path>", "Specific rollout JSONL file to summarize");
}

function addDreamCandidateIdOption(command: Command): Command {
  return command.option("--candidate-id <id>", "Dream candidate id");
}

const dreamStatusChoices = ["pending", "approved", "rejected", "promoted", "stale", "blocked"];
const dreamTargetSurfaceChoices = ["durable-memory", "instruction-memory"];
const dreamOriginKindChoices = ["primary", "subagent"];

function registerSessionCommands(program: Command): void {
  const sessionCommand = program
    .command("session")
    .description("Manage temporary cross-session continuity state");

  addJsonOption(
    sessionCommand
      .command("status")
      .description("Inspect current session continuity state")
  )
    .action(withStdout(async (options) => runSession("status", options)));

  addSessionScopeOption(
    addSessionRolloutOption(
      addJsonOption(
        sessionCommand
          .command("save")
          .description("Save temporary session continuity from a rollout")
      )
    )
  )
    .action(withStdout(async (options) => runSession("save", options)));

  addSessionScopeOption(
    addSessionRolloutOption(
      addJsonOption(
        sessionCommand
          .command("refresh")
          .description("Regenerate session continuity from provenance and replace the selected scope")
      )
    )
  )
    .action(withStdout(async (options) => runSession("refresh", options)));

  addJsonOption(
    sessionCommand
      .command("load")
      .description("Load current session continuity summary and, with --print-startup, inspect the structured continuity startup contract")
  )
    .option("--print-startup", "Print the compiled startup continuity block")
    .action(withStdout(async (options) => runSession("load", options)));

  addSessionScopeOption(
    sessionCommand
      .command("clear")
      .description("Clear active session continuity state")
  )
    .action(withStdout(async (options) => runSession("clear", options)));

  sessionCommand
    .command("open")
    .description("Open the local session continuity directory")
    .action(withStdout(async (options) => runSession("open", options)));
}

function registerDreamCommands(program: Command): void {
  const dreamCommand = program
    .command("dream")
    .description("Build, inspect, and review the background consolidation sidecar without mutating canonical memory by default");

  addSessionScopeOption(
    addSessionRolloutOption(
      addJsonOption(
        dreamCommand
          .command("build")
          .description("Build a dream sidecar snapshot from the selected rollout")
      )
    )
  ).action(withStdout(async (options) => runDream("build", options)));

  addJsonOption(
    dreamCommand
      .command("inspect")
      .description("Inspect the latest dream sidecar snapshots and audit paths")
  ).action(withStdout(async (options) => runDream("inspect", options)));

  addJsonOption(
    dreamCommand
      .command("candidates")
      .description("List explicit dream promotion candidates from the reviewer queue")
      .addOption(
        new Option("--status <status>", "Filter by candidate status").choices(dreamStatusChoices)
      )
      .addOption(
        new Option(
          "--target-surface <surface>",
          "Filter by target surface: durable-memory or instruction-memory"
        ).choices(dreamTargetSurfaceChoices)
      )
      .addOption(
        new Option(
          "--origin-kind <kind>",
          "Filter by origin kind: primary or subagent"
        ).choices(dreamOriginKindChoices)
      )
  ).action(withStdout(async (options) => runDream("candidates", options)));

  addJsonOption(
    addDreamCandidateIdOption(
      dreamCommand
        .command("review")
        .description("Review a dream candidate without mutating canonical memory")
        .option("--approve", "Approve the candidate for explicit promotion")
        .option("--reject", "Reject the candidate")
        .option("--defer", "Return the candidate to the pending lane")
        .option("--note <text>", "Reviewer note to record with the decision")
    )
  ).action(withStdout(async (options) => runDream("review", options)));

  addJsonOption(
    addDreamCandidateIdOption(
      dreamCommand
        .command("adopt")
        .description("Adopt a blocked subagent dream candidate into the primary review lane")
        .option("--note <text>", "Reviewer note to record with the adoption")
    )
  ).action(withStdout(async (options) => runDream("adopt", options)));

  addJsonOption(
    addSessionScopeOption(
      addDreamCandidateIdOption(
        dreamCommand
          .command("promote-prep")
          .description("Preview the outcome of promoting an approved dream candidate without mutating canonical memory")
          .option("--topic <topic>", "Override the inferred durable memory topic")
          .option("--id <id>", "Override the inferred durable memory id")
      )
    )
  ).action(withStdout(async (options) => runDream("promote-prep", options)));

  addJsonOption(
    addSessionScopeOption(
      addDreamCandidateIdOption(
        dreamCommand
          .command("promote")
          .description("Explicitly promote an approved dream candidate")
          .option("--topic <topic>", "Override the inferred durable memory topic")
          .option("--id <id>", "Override the inferred durable memory id")
      )
    )
  ).action(withStdout(async (options) => runDream("promote", options)));
}

function registerHookCommands(program: Command): void {
  const hooksCommand = program
    .command("hooks")
    .description("Manage the local bridge / fallback helper bundle for current and upcoming integrations");

  addJsonOption(
    hooksCommand
      .command("install")
      .description(
        "Generate the local bridge / fallback helper bundle, including recall, startup, post-session, and post-work review helpers"
      )
      .option("--cwd <path>", "Project directory to anchor generated hook helpers to")
  ).action(withStdout(async (options) => installHooks(options)));

  hooksCommand
    .command("remove")
    .description("Describe how to remove generated hook bridge assets")
    .action(withStdout(async () => removeHooks()));
}

function registerSkillCommands(program: Command): void {
  const skillSurfaceChoices = formatCodexSkillInstallSurfaceChoices();
  const skillsCommand = program
    .command("skills")
    .description(
      "Manage Codex skill assets for MCP-first durable memory retrieval with local-bridge and resolved CLI fallback"
    );

  addJsonOption(
    skillsCommand
      .command("install")
      .description(
        "Install a Codex skill that teaches search -> timeline -> details memory retrieval. Skills are guidance-only; runtime remains the default surface and official .agents/skills copies stay opt-in."
      )
      .option(
        "--surface <surface>",
        `Skill install surface: ${skillSurfaceChoices}`,
        DEFAULT_CODEX_SKILL_INSTALL_SURFACE
      )
      .option("--cwd <path>", "Project directory to anchor project-scoped skill installs to")
  ).action(withStdout(async (options) => installSkills(options)));

  skillsCommand
    .command("remove")
    .description("Describe how to remove the installed Codex skill assets")
    .option(
      "--surface <surface>",
      `Skill surface to remove: ${skillSurfaceChoices}`,
      DEFAULT_CODEX_SKILL_INSTALL_SURFACE
    )
    .option("--cwd <path>", "Project directory to anchor project-scoped skill installs to")
    .action(withStdout(async (options) => removeSkills(options)));
}

function registerRecallCommands(program: Command): void {
  const recallCommand = program
    .command("recall")
    .description("Search, inspect, and drill into durable memory with progressive disclosure");

  addJsonOption(
    recallCommand
      .command("search")
      .description("Search compact memory candidates without loading full details")
      .argument("<query>", "Search query")
      .option("--scope <scope>", "Limit search scope: global, project, project-local, or all", "all")
      .option(
        "--state <state>",
        "Limit memory state: active, archived, all, or auto",
        "auto"
      )
      .option("--limit <count>", "Maximum number of results to return", "8")
      .option("--cwd <path>", "Project directory to anchor recall to")
  ).action(withStdout(async (query, options) => runRecall("search", query, options)));

  addJsonOption(
    recallCommand
      .command("timeline")
      .description("Show the recorded lifecycle timeline for a specific memory ref")
      .argument("<ref>", "Memory ref from recall search")
      .option("--cwd <path>", "Project directory to anchor recall to")
  ).action(withStdout(async (ref, options) => runRecall("timeline", ref, options)));

  addJsonOption(
    recallCommand
      .command("details")
      .description("Fetch full Markdown-backed details for a specific memory ref")
      .argument("<ref>", "Memory ref from recall search")
      .option("--cwd <path>", "Project directory to anchor recall to")
  ).action(withStdout(async (ref, options) => runRecall("details", ref, options)));
}

function registerMcpCommands(program: Command): void {
  const supportedInstallHosts = formatMcpHostChoices(SUPPORTED_MCP_INSTALL_HOSTS);
  const supportedSnippetHosts = formatMcpHostChoices(SUPPORTED_MCP_HOSTS);
  const supportedDoctorHosts = formatMcpHostChoices(SUPPORTED_MCP_DOCTOR_HOST_SELECTIONS);
  const mcpCommand = program
    .command("mcp")
    .description(
      "Serve the retrieval MCP plane, print or install host snippets, and inspect project wiring"
    );

  mcpCommand
    .command("serve")
    .description(
      "Start a read-only retrieval MCP server with search_memories, timeline_memories, and get_memory_details"
    )
    .option("--cwd <path>", "Project directory to anchor retrieval to")
    .action(async (options) => {
      await runMcpServe(options);
    });

  addJsonOption(
    mcpCommand
      .command("install")
      .description("Install the recommended project-scoped MCP wiring for a supported host")
      .requiredOption("--host <host>", `Target host: ${supportedInstallHosts}`)
      .option("--cwd <path>", "Project directory to write host wiring for")
  ).action(withStdout(async (options) => runMcpInstall(options)));

  addJsonOption(
    mcpCommand
      .command("print-config")
      .description("Print a ready-to-paste MCP config snippet for a supported host")
      .requiredOption("--host <host>", `Target host: ${supportedSnippetHosts}`)
      .option("--cwd <path>", "Project directory to render the snippet for")
  ).action(withStdout(async (options) => runMcpPrintConfig(options)));

  addJsonOption(
    mcpCommand
      .command("apply-guidance")
      .description("Safely create or update the managed Codex Auto Memory block inside AGENTS.md")
      .requiredOption("--host <host>", `Target host: ${formatMcpHostChoices(["codex"])}`)
      .option("--cwd <path>", "Project directory whose AGENTS.md should be updated")
  ).action(withStdout(async (options) => runMcpApplyGuidance(options)));

  addJsonOption(
    mcpCommand
      .command("doctor")
      .description("Inspect the recommended project-scoped MCP wiring without writing host config, including route truth and operational blockers")
      .option("--host <host>", `Target host: ${supportedDoctorHosts}`, "all")
      .option("--cwd <path>", "Project directory to inspect")
  ).action(withStdout(async (options) => runMcpDoctor(options)));
}

function registerIntegrationCommands(program: Command): void {
  const skillSurfaceChoices = formatCodexSkillInstallSurfaceChoices();
  const integrationsCommand = program
    .command("integrations")
    .description("Install the recommended Codex integration stack on top of existing hook, skill, and MCP surfaces");

  addJsonOption(
    integrationsCommand
      .command("apply")
      .description(
        "Install the recommended Codex integration stack and safely apply the managed AGENTS guidance block. The runtime default stays in place unless you opt into an official copy."
      )
      .requiredOption("--host <host>", `Target host: ${formatMcpHostChoices(["codex"])}`)
      .option(
        "--skill-surface <surface>",
        `Skill install surface: ${skillSurfaceChoices}`,
        DEFAULT_CODEX_SKILL_INSTALL_SURFACE
      )
      .option("--cwd <path>", "Project directory to write host wiring for")
  ).action(withStdout(async (options) => runIntegrationsApply(options)));

  addJsonOption(
    integrationsCommand
      .command("install")
      .description(
        "Install the recommended project-scoped Codex integration stack without updating AGENTS.md. The runtime default stays in place unless you opt into an official copy."
      )
      .requiredOption("--host <host>", `Target host: ${formatMcpHostChoices(["codex"])}`)
      .option(
        "--skill-surface <surface>",
        `Skill install surface: ${skillSurfaceChoices}`,
        DEFAULT_CODEX_SKILL_INSTALL_SURFACE
      )
      .option("--cwd <path>", "Project directory to write host wiring for")
  ).action(withStdout(async (options) => runIntegrationsInstall(options)));

  addJsonOption(
    integrationsCommand
      .command("doctor")
      .description("Inspect the current Codex integration stack without mutating memory or host config")
      .requiredOption("--host <host>", `Target host: ${formatMcpHostChoices(["codex"])}`)
      .option("--cwd <path>", "Project directory to inspect")
  ).action(withStdout(async (options) => runIntegrationsDoctor(options)));
}

export function registerCommands(program: Command): void {
  program
    .command("init")
    .description("Initialize Codex Auto Memory in the current project")
    .option("--force", "Overwrite existing init config files with canonical defaults")
    .action(withStdout(async (options) => runInit(options)));

  const memoryCommand = program
    .command("memory")
    .description("Inspect local memory state and manage local memory settings")
    .option("--json", "Print JSON output")
    .option("--cwd <path>", "Project directory to inspect or manage local memory for")
    .option(
      "--scope <scope>",
      "Show a single memory scope: global, project, project-local, or all",
      "all"
    )
    .option("--recent [count]", "Show recent sync audit entries")
    .option("--enable", "Enable auto memory in config")
    .option("--disable", "Disable auto memory in config")
    .option("--config-scope <scope>", "Config scope to edit: user, project, or local", "local")
    .option("--print-startup", "Print the compiled startup memory block")
    .option("--open", "Open the memory directory in the default file browser")
    .action(withStdout(async (options) => runMemory(options)));
  memoryCommand.enablePositionalOptions();

  addJsonOption(
    memoryCommand
      .command("reindex")
      .description("Rebuild retrieval sidecars from canonical Markdown memory")
      .option("--cwd <path>", "Project directory to rebuild retrieval sidecars for")
      .option(
        "--scope <scope>",
        "Rebuild a single memory scope: global, project, project-local, or all",
        "all"
      )
      .option(
        "--state <state>",
        "Rebuild active, archived, or all retrieval sidecars",
        "all"
      )
  ).action(
    withStdout(async (options, command) => {
      const parent = command.parent;
      const subcommandOptions = command.opts() as Record<string, unknown>;
      const subcommandJson =
        command.getOptionValueSource("json") === "cli"
          ? (subcommandOptions.json as boolean | undefined)
          : undefined;
      const subcommandCwd =
        command.getOptionValueSource("cwd") === "cli"
          ? (subcommandOptions.cwd as string | undefined)
          : undefined;
      const subcommandScope =
        command.getOptionValueSource("scope") === "cli"
          ? (subcommandOptions.scope as string | undefined)
          : undefined;
      const subcommandState =
        command.getOptionValueSource("state") === "cli"
          ? (subcommandOptions.state as string | undefined)
          : undefined;
      const explicitParentOptions =
        parent
          ? Object.fromEntries(
              [
                "json",
                "cwd",
                "scope",
                "recent",
                "enable",
                "disable",
                "configScope",
                "printStartup",
                "open"
              ]
                .filter((key) => parent.getOptionValueSource(key) === "cli")
                .map((key) => [key, (parent.opts() as Record<string, unknown>)[key]])
            )
          : {};

      return runMemoryReindex({
        ...explicitParentOptions,
        json: subcommandJson ?? (explicitParentOptions.json as boolean | undefined),
        cwd: subcommandCwd ?? (explicitParentOptions.cwd as string | undefined),
        scope:
          (subcommandScope ??
            (explicitParentOptions.scope as string | undefined) ??
            "all") as MemoryReindexCommandOptions["scope"],
        state: (subcommandState ?? "all") as MemoryReindexCommandOptions["state"]
      });
    })
  );

  program
    .command("remember")
    .description("Persist a memory entry immediately")
    .argument("<text>", "Memory summary text")
    .option("--cwd <path>", "Project directory to anchor remember to")
    .option("--scope <scope>", "Memory scope: global, project, or project-local")
    .option("--topic <topic>", "Topic file name")
    .option("--detail <detail...>", "Additional detail bullets")
    .option("--json", "Print JSON output")
    .action(withStdout(async (text, options) => runRemember(text, options)));

  program
    .command("forget")
    .description("Delete matching memory entries")
    .argument(
      "<query>",
      "Search query used to find memory entries; multi-term queries match across id/summary/details"
    )
    .option("--cwd <path>", "Project directory to anchor forget to")
    .option("--scope <scope>", "Specific scope to target, or all")
    .option("--archive", "Move matching entries into archive instead of deleting them")
    .option("--json", "Print JSON output")
    .action(withStdout(async (query, options) => runForget(query, options)));

  program
    .command("sync")
    .description("Sync the latest rollout into markdown memory")
    .option("--rollout <path>", "Specific rollout JSONL file to process")
    .option("--force", "Re-process a rollout even if it was already synced")
    .action(withStdout(async (options) => runSync(options)));

  program
    .command("doctor")
    .description("Inspect local Codex Auto Memory wiring and environment")
    .option("--json", "Print JSON output")
    .action(withStdout(async (options) => runDoctor(options)));

  program
    .command("audit")
    .description("Scan tracked files and git history for privacy and secret-hygiene risks")
    .option("--json", "Print JSON output")
    .option("--history", "Force-enable git history scanning")
    .option("--no-history", "Disable git history scanning")
    .action(withStdout(async (options) => runAudit(options)));

  registerSessionCommands(program);
  registerDreamCommands(program);
  registerRecallCommands(program);
  registerMcpCommands(program);
  registerHookCommands(program);
  registerSkillCommands(program);
  registerIntegrationCommands(program);
}
