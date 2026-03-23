#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";
import { registerCommands } from "./lib/cli/register-commands.js";
import { runWrappedCodex } from "./lib/commands/wrapper.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

function isWrapperCommand(input?: string): input is "run" | "exec" | "resume" {
  return input === "run" || input === "exec" || input === "resume";
}

function createProgram(): Command {
  const program = new Command();
  program.name("cam").description("Codex Auto Memory companion CLI").version(version);
  registerCommands(program);
  return program;
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (isWrapperCommand(rawArgs[0])) {
    const exitCode = await runWrappedCodex(process.cwd(), rawArgs[0], rawArgs.slice(1));
    process.exitCode = exitCode;
    return;
  }

  await createProgram().parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
