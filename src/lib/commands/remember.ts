import { slugify } from "../util/text.js";
import type { MemoryScope } from "../types.js";
import { buildRuntimeContext } from "../runtime/runtime-context.js";

interface RememberOptions {
  cwd?: string;
  scope?: MemoryScope;
  topic?: string;
  detail?: string[];
}

export async function runRemember(
  text: string,
  options: RememberOptions = {}
): Promise<string> {
  const runtime = await buildRuntimeContext(options.cwd);
  const scope = options.scope ?? runtime.loadedConfig.config.defaultScope;
  const topic = options.topic ?? "workflow";
  const details = options.detail?.length ? options.detail : [text];
  const id = slugify(text);

  await runtime.syncService.memoryStore.remember(
    scope,
    topic,
    id,
    text,
    details,
    "Manual remember request."
  );

  return `Saved memory to ${scope}/${topic} with id ${id}.`;
}
