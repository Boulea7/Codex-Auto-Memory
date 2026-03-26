import { buildRuntimeContext } from "../runtime/runtime-context.js";
import type { MemoryScope } from "../types.js";

interface ForgetOptions {
  cwd?: string;
  scope?: MemoryScope | "all";
  archive?: boolean;
}

export async function runForget(
  query: string,
  options: ForgetOptions = {}
): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd);
  const deleted = await runtime.syncService.memoryStore.forget(options.scope ?? "all", query, {
    archive: options.archive
  });
  if (deleted.length === 0) {
    return `No memory entries matched "${query}".`;
  }

  return [
    `${options.archive ? "Archived" : "Deleted"} ${deleted.length} memory entr${deleted.length === 1 ? "y" : "ies"}:`,
    ...deleted.map((entry) => `- ${entry.scope}/${entry.topic}/${entry.id}: ${entry.summary}`)
  ].join("\n");
}
