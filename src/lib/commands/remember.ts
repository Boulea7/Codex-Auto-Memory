import { slugify } from "../util/text.js";
import type { MemoryScope } from "../types.js";
import { buildRuntimeContext } from "../runtime/runtime-context.js";
import { canonicalCommandSignature } from "../extractor/command-signatures.js";
import {
  buildManualMutationReviewEntry,
  formatManualMutationTextFollowUp,
  toManualMutationRememberPayload
} from "./manual-mutation-review.js";

interface RememberOptions {
  cwd?: string;
  scope?: MemoryScope;
  topic?: string;
  detail?: string[];
  json?: boolean;
}

function inferRememberTopic(text: string): string {
  if (
    /`[^`]*(?:pnpm|npm|bun|yarn|cargo|pytest|jest|vitest|go test|python(?:3)? -m|make)[^`]*`/iu.test(
      text
    ) ||
    /\b(?:command|run\s+(?:pnpm|npm|bun|yarn|cargo|pytest|jest|vitest|go test|python(?:3)? -m|make)|(?:pnpm|npm|bun|yarn|cargo)\s+(?:test|lint|build|install|check)|pytest|jest|vitest|go test|dotnet test|rake|tsc|vite build|next build|gradle|mvn|make)\b/iu.test(
      text
    )
  ) {
    return "commands";
  }

  if (
    /(https?:\/\/|grafana|linear|jira|slack|notion|confluence|runbook|playbook|wiki|dashboard|docs?\b|tracked in|board\b|channel\b)/iu.test(
      text
    )
  ) {
    return "reference";
  }

  if (/(pnpm|npm|bun|yarn|format|style|indent|naming|comment|typescript|always use|prefer)/iu.test(text)) {
    return "preferences";
  }

  if (/(debug|error|fix|fails|failing|redis|database|timeout|requires|must start|before running)/iu.test(text)) {
    return "debugging";
  }

  if (
    /(architecture|module|api|route|entity|service|controller|schema|markdown-first|db-first|database-first|source of truth|canonical)/iu.test(
      text
    )
  ) {
    return "architecture";
  }

  if (/(pattern|convention|reuse|shared)/iu.test(text)) {
    return "patterns";
  }

  return "workflow";
}

function normalizeRememberText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/gu, " ");
}

function collectCommandSignatures(texts: string[]): Set<string> {
  const signatures = new Set<string>();
  for (const text of texts) {
    const directSignature = canonicalCommandSignature(text);
    if (directSignature) {
      signatures.add(directSignature);
    }

    for (const match of text.matchAll(/`([^`]+)`/gu)) {
      const command = match[1]?.trim();
      if (!command) {
        continue;
      }
      const signature = canonicalCommandSignature(command);
      if (signature) {
        signatures.add(signature);
      }
    }
  }

  return signatures;
}

async function resolveRememberTarget(
  runtime: Awaited<ReturnType<typeof buildRuntimeContext>>,
  scope: MemoryScope,
  topic: string,
  summary: string,
  details: string[]
): Promise<{ topic: string; id: string } | null> {
  const entries = (await runtime.syncService.memoryStore.listEntries(scope, "active", {
    excludeUnsafeTopics: true
  })).filter((entry) => entry.topic === topic);

  const normalizedSummary = normalizeRememberText(summary);
  const normalizedDetails = new Set(details.map((detail) => normalizeRememberText(detail)));
  const exactMatches = entries.filter((entry) => {
    if (normalizeRememberText(entry.summary) === normalizedSummary) {
      return true;
    }

    return entry.details.some((detail) => normalizedDetails.has(normalizeRememberText(detail)));
  });
  if (exactMatches.length === 1) {
    return {
      topic: exactMatches[0]!.topic,
      id: exactMatches[0]!.id
    };
  }

  if (topic !== "commands") {
    return null;
  }

  const desiredSignatures = collectCommandSignatures([summary, ...details]);
  if (desiredSignatures.size === 0) {
    return null;
  }

  const commandMatches = entries.filter((entry) => {
    const existingSignatures = collectCommandSignatures([entry.summary, ...entry.details]);
    for (const signature of existingSignatures) {
      if (desiredSignatures.has(signature)) {
        return true;
      }
    }

    return false;
  });
  if (commandMatches.length !== 1) {
    return null;
  }

  return {
    topic: commandMatches[0]!.topic,
    id: commandMatches[0]!.id
  };
}

export async function runRemember(
  text: string,
  options: RememberOptions = {}
): Promise<string> {
  if (text.trim().length === 0) {
    throw new Error("Remember text must be non-empty.");
  }

  const runtime = await buildRuntimeContext(options.cwd);
  const scope = options.scope ?? runtime.loadedConfig.config.defaultScope;
  const topic = options.topic ?? inferRememberTopic(text);
  const details = options.detail?.length ? options.detail : [text];
  const target = await resolveRememberTarget(runtime, scope, topic, text, details);
  const rememberedTopic = target?.topic ?? topic;
  const id = target?.id ?? slugify(text);

  const record = await runtime.syncService.memoryStore.remember(
    scope,
    rememberedTopic,
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
    return JSON.stringify(
      toManualMutationRememberPayload(text, reviewEntry, {
        cwd: runtime.project.projectRoot,
        publicPathContext: {
          projectRoot: runtime.project.projectRoot,
          memoryRoot: runtime.syncService.memoryStore.paths.baseDir
        }
      }),
      null,
      2
    );
  }

  if (record?.lifecycleAction === "noop") {
    return `Memory ${scope}/${rememberedTopic}/${id} is already up to date.`;
  }

  if (!record) {
    return `Saved memory to ${scope}/${rememberedTopic} with id ${id}.`;
  }

  const reviewEntry = await buildManualMutationReviewEntry(runtime.syncService.memoryStore, record);
  return [
    `Saved memory to ${scope}/${rememberedTopic} with id ${id}.`,
    ...formatManualMutationTextFollowUp([reviewEntry], {
      cwd: runtime.project.projectRoot
    })
  ].join("\n");
}
