import type { CompiledStartupMemory, MemoryScope } from "../types.js";
import { DEFAULT_STARTUP_LINE_LIMIT } from "../constants.js";
import { limitLines } from "../util/text.js";
import { MemoryStore } from "./memory-store.js";

function heading(scope: MemoryScope): string {
  switch (scope) {
    case "global":
      return "Global";
    case "project":
      return "Project";
    case "project-local":
      return "Project Local";
  }
}

export async function compileStartupMemory(
  store: MemoryStore,
  maxLines = DEFAULT_STARTUP_LINE_LIMIT
): Promise<CompiledStartupMemory> {
  const parts: string[] = [
    "# Codex Auto Memory",
    "Treat the following notes as editable local context, not immutable policy.",
    "If the user corrects any item, prefer the correction and update memory when asked.",
    ""
  ];
  const sourceFiles: string[] = [];

  for (const scope of ["project-local", "project", "global"] satisfies MemoryScope[]) {
    const filePath = store.getMemoryFile(scope);
    const contents = await store.readMemoryFile(scope);
    const lines = contents.split("\n");
    sourceFiles.push(filePath);
    parts.push(`## ${heading(scope)}`);
    parts.push(...lines);
    parts.push("");
  }

  const raw = parts.join("\n").trim();
  const limited = limitLines(raw, maxLines);
  return {
    text: `${limited}\n`,
    lineCount: limited.split("\n").length,
    sourceFiles
  };
}

