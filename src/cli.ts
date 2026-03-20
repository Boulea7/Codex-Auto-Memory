#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";
import { runInit } from "./lib/commands/init.js";
import { runMemory } from "./lib/commands/memory.js";
import { runRemember } from "./lib/commands/remember.js";
import { runForget } from "./lib/commands/forget.js";
import { runSync } from "./lib/commands/sync.js";
import { runDoctor } from "./lib/commands/doctor.js";
import { installHooks, removeHooks } from "./lib/commands/hooks.js";
import { runWrappedCodex } from "./lib/commands/wrapper.js";
import { runAudit } from "./lib/commands/audit.js";
import { runSession } from "./lib/commands/session.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

function isWrapperCommand(input?: string): input is "run" | "exec" | "resume" {
  return input === "run" || input === "exec" || input === "resume";
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (isWrapperCommand(rawArgs[0])) {
    const exitCode = await runWrappedCodex(process.cwd(), rawArgs[0], rawArgs.slice(1));
    process.exitCode = exitCode;
    return;
  }

  const program = new Command();
  program
    .name("cam")
    .description("Codex Auto Memory companion CLI")
    .version(version);

  program
    .command("init")
    .description("Initialize Codex Auto Memory in the current project")
    .action(async () => {
      process.stdout.write(`${await runInit()}\n`);
    });

  program
    .command("memory")
    .description("Inspect local memory state")
    .option("--json", "Print JSON output")
    .option("--scope <scope>", "Show a single memory scope: global, project, project-local, or all", "all")
    .option("--recent [count]", "Show recent sync audit entries")
    .option("--enable", "Enable auto memory in config")
    .option("--disable", "Disable auto memory in config")
    .option("--config-scope <scope>", "Config scope to edit: user, project, or local", "local")
    .option("--print-startup", "Print the compiled startup memory block")
    .option("--open", "Open the memory directory in the default file browser")
    .action(async (options) => {
      process.stdout.write(`${await runMemory(options)}\n`);
    });

  program
    .command("remember")
    .description("Persist a memory entry immediately")
    .argument("<text>", "Memory summary text")
    .option("--scope <scope>", "Memory scope: global, project, or project-local")
    .option("--topic <topic>", "Topic file name", "workflow")
    .option("--detail <detail...>", "Additional detail bullets")
    .action(async (text, options) => {
      process.stdout.write(`${await runRemember(text, options)}\n`);
    });

  program
    .command("forget")
    .description("Delete matching memory entries")
    .argument("<query>", "Search query used to find memory entries")
    .option("--scope <scope>", "Specific scope to target, or all")
    .action(async (query, options) => {
      process.stdout.write(`${await runForget(query, options)}\n`);
    });

  program
    .command("sync")
    .description("Sync the latest rollout into markdown memory")
    .option("--rollout <path>", "Specific rollout JSONL file to process")
    .option("--force", "Re-process a rollout even if it was already synced")
    .action(async (options) => {
      process.stdout.write(`${await runSync(options)}\n`);
    });

  program
    .command("doctor")
    .description("Inspect local Codex Auto Memory wiring and environment")
    .option("--json", "Print JSON output")
    .action(async (options) => {
      process.stdout.write(`${await runDoctor(options)}\n`);
    });

  program
    .command("audit")
    .description("Scan tracked files and git history for privacy and secret-hygiene risks")
    .option("--json", "Print JSON output")
    .option("--history", "Force-enable git history scanning")
    .option("--no-history", "Disable git history scanning")
    .action(async (options) => {
      process.stdout.write(`${await runAudit(options)}\n`);
    });

  const sessionCommand = program.command("session").description("Manage temporary cross-session continuity state");
  sessionCommand
    .command("status")
    .description("Inspect current session continuity state")
    .option("--json", "Print JSON output")
    .action(async (options) => {
      process.stdout.write(`${await runSession("status", options)}\n`);
    });
  sessionCommand
    .command("save")
    .description("Save temporary session continuity from a rollout")
    .option("--json", "Print JSON output")
    .option("--rollout <path>", "Specific rollout JSONL file to summarize")
    .option("--scope <scope>", "Target continuity scope: project, project-local, or both", "both")
    .action(async (options) => {
      process.stdout.write(`${await runSession("save", options)}\n`);
    });
  sessionCommand
    .command("refresh")
    .description("Regenerate session continuity from provenance and replace the selected scope")
    .option("--json", "Print JSON output")
    .option("--rollout <path>", "Specific rollout JSONL file to summarize")
    .option("--scope <scope>", "Target continuity scope: project, project-local, or both", "both")
    .action(async (options) => {
      process.stdout.write(`${await runSession("refresh", options)}\n`);
    });
  sessionCommand
    .command("load")
    .description("Load current session continuity summary")
    .option("--json", "Print JSON output")
    .option("--print-startup", "Print the compiled startup continuity block")
    .action(async (options) => {
      process.stdout.write(`${await runSession("load", options)}\n`);
    });
  sessionCommand
    .command("clear")
    .description("Clear active session continuity state")
    .option("--scope <scope>", "Target continuity scope: project, project-local, or both", "both")
    .action(async (options) => {
      process.stdout.write(`${await runSession("clear", options)}\n`);
    });
  sessionCommand
    .command("open")
    .description("Open the local session continuity directory")
    .action(async (options) => {
      process.stdout.write(`${await runSession("open", options)}\n`);
    });

  const hooksCommand = program.command("hooks").description("Manage future hook bridge assets");
  hooksCommand
    .command("install")
    .description("Generate local hook bridge assets")
    .action(async () => {
      process.stdout.write(`${await installHooks()}\n`);
    });
  hooksCommand
    .command("remove")
    .description("Describe how to remove generated hook bridge assets")
    .action(async () => {
      process.stdout.write(`${await removeHooks()}\n`);
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
