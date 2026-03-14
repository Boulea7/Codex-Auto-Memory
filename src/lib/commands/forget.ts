import { buildRuntimeContext } from "./common.js";
import type { MemoryScope } from "../types.js";

interface ForgetOptions {
  cwd?: string;
  scope?: MemoryScope | "all";
}

export async function runForget(
  query: string,
  options: ForgetOptions = {}
): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd);
  const deleted = await runtime.syncService.memoryStore.forget(options.scope ?? "all", query);
  if (deleted.length === 0) {
    return `No memory entries matched "${query}".`;
  }

  return [
    `Deleted ${deleted.length} memory entr${deleted.length === 1 ? "y" : "ies"}:`,
    ...deleted.map((entry) => `- ${entry.scope}/${entry.topic}/${entry.id}: ${entry.summary}`)
  ].join("\n");
}

