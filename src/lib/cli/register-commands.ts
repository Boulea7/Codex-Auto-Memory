import { Command } from "commander";
import { runAudit } from "../commands/audit.js";
import { runDoctor } from "../commands/doctor.js";
import { runForget } from "../commands/forget.js";
import { installHooks, removeHooks } from "../commands/hooks.js";
import { runInit } from "../commands/init.js";
import { runMemory } from "../commands/memory.js";
import { runRemember } from "../commands/remember.js";
import { runSession } from "../commands/session.js";
import { runSync } from "../commands/sync.js";

type AsyncCommandHandler<Args extends unknown[]> = (...args: Args) => Promise<string>;

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
      .description("Load current session continuity summary")
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

function registerHookCommands(program: Command): void {
  const hooksCommand = program
    .command("hooks")
    .description("Manage future hook bridge assets");

  hooksCommand
    .command("install")
    .description("Generate local hook bridge assets")
    .action(withStdout(async () => installHooks()));

  hooksCommand
    .command("remove")
    .description("Describe how to remove generated hook bridge assets")
    .action(withStdout(async () => removeHooks()));
}

export function registerCommands(program: Command): void {
  program
    .command("init")
    .description("Initialize Codex Auto Memory in the current project")
    .action(withStdout(async () => runInit()));

  program
    .command("memory")
    .description("Inspect local memory state")
    .option("--json", "Print JSON output")
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

  program
    .command("remember")
    .description("Persist a memory entry immediately")
    .argument("<text>", "Memory summary text")
    .option("--scope <scope>", "Memory scope: global, project, or project-local")
    .option("--topic <topic>", "Topic file name", "workflow")
    .option("--detail <detail...>", "Additional detail bullets")
    .action(withStdout(async (text, options) => runRemember(text, options)));

  program
    .command("forget")
    .description("Delete matching memory entries")
    .argument("<query>", "Search query used to find memory entries")
    .option("--scope <scope>", "Specific scope to target, or all")
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
  registerHookCommands(program);
}
