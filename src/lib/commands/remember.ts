import { slugify } from "../util/text.js";
import type { MemoryScope } from "../types.js";
import { buildRuntimeContext } from "../runtime/runtime-context.js";
import {
  buildManualMutationReviewEntry,
  toManualMutationRememberPayload
} from "./manual-mutation-review.js";

interface RememberOptions {
  cwd?: string;
  scope?: MemoryScope;
  topic?: string;
  detail?: string[];
  json?: boolean;
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

  const record = await runtime.syncService.memoryStore.remember(
    scope,
    topic,
    id,
    text,
    details,
    "Manual remember request."
  );

  if (options.json) {
    if (!record) {
      throw new Error("Remember command did not produce a mutation record.");
    }
    const reviewEntry = await buildManualMutationReviewEntry(runtime.syncService.memoryStore, record);
    return JSON.stringify(toManualMutationRememberPayload(text, reviewEntry), null, 2);
  }

  if (record?.lifecycleAction === "noop") {
    return `Memory ${scope}/${topic}/${id} is already up to date.`;
  }

  return `Saved memory to ${scope}/${topic} with id ${id}.`;
}
