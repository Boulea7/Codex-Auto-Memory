import { buildRuntimeContext } from "../runtime/runtime-context.js";
import type { MemoryScope } from "../types.js";
import {
  buildManualMutationReviewEntry,
  formatManualMutationTextFollowUp,
  toManualMutationForgetPayload
} from "./manual-mutation-review.js";

interface ForgetOptions {
  cwd?: string;
  scope?: MemoryScope | "all";
  archive?: boolean;
  json?: boolean;
}

export async function runForget(
  query: string,
  options: ForgetOptions = {}
): Promise<string> {
  if (query.trim().length === 0) {
    throw new Error("Forget query must be non-empty.");
  }

  const runtime = await buildRuntimeContext(options.cwd);
  const targetScope = options.scope ?? "all";
  const deleted = await runtime.syncService.memoryStore.forget(targetScope, query, {
    archive: options.archive
  });

  if (options.json) {
    const reviewEntries = await Promise.all(
      deleted.map(async (entry) =>
        buildManualMutationReviewEntry(runtime.syncService.memoryStore, {
          operation: {
            action: options.archive ? "archive" : "delete",
            scope: entry.scope,
            topic: entry.topic,
            id: entry.id,
            summary: entry.summary,
            details: entry.details,
            sources: ["manual"],
            reason: options.archive ? "Manual archive request." : "Explicit forget instruction from the user."
          },
          lifecycleAction: options.archive ? "archive" : "delete",
          previousState: "active",
          nextState: options.archive ? "archived" : "deleted"
        })
      )
    );
    return JSON.stringify(
      toManualMutationForgetPayload(query, targetScope, Boolean(options.archive), reviewEntries, {
        cwd: runtime.project.projectRoot
      }),
      null,
      2
    );
  }

  if (deleted.length === 0) {
    return `No memory entries matched "${query}".`;
  }

  const reviewEntries = await Promise.all(
    deleted.map(async (entry) =>
      buildManualMutationReviewEntry(runtime.syncService.memoryStore, {
        operation: {
          action: options.archive ? "archive" : "delete",
          scope: entry.scope,
          topic: entry.topic,
          id: entry.id,
          summary: entry.summary,
          details: entry.details,
          sources: ["manual"],
          reason: options.archive ? "Manual archive request." : "Explicit forget instruction from the user."
        },
        lifecycleAction: options.archive ? "archive" : "delete",
        previousState: "active",
        nextState: options.archive ? "archived" : "deleted"
      })
    )
  );

  return [
    `${options.archive ? "Archived" : "Deleted"} ${deleted.length} memory entr${deleted.length === 1 ? "y" : "ies"}:`,
    ...deleted.map((entry) => `- ${entry.scope}/${entry.topic}/${entry.id}: ${entry.summary}`),
    ...formatManualMutationTextFollowUp(reviewEntries, {
      cwd: runtime.project.projectRoot
    })
  ].join("\n");
}
