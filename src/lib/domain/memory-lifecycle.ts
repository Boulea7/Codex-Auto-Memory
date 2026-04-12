import type {
  MemoryEntry,
  MemoryHistoryRecordState,
  MemoryLifecycleAction,
  MemoryLifecycleUpdateKind,
  MemoryRecordState,
  MemoryRef,
  MemoryScope
} from "../types.js";

const allowedScopes = new Set<MemoryScope>(["global", "project", "project-local"]);
const allowedStates = new Set<MemoryRecordState>(["active", "archived"]);
const allowedHistoryStates = new Set<MemoryHistoryRecordState>(["active", "archived", "deleted"]);

export function buildMemoryRef(
  scope: MemoryScope,
  state: MemoryRecordState,
  topic: string,
  id: string
): string {
  return `${scope}:${state}:${topic}:${id}`;
}

export function parseMemoryRef(ref: string): MemoryRef | null {
  const [scope, state, topic, ...idParts] = ref.split(":");
  const id = idParts.join(":");
  if (
    !scope ||
    !state ||
    !topic ||
    idParts.length === 0 ||
    id.length === 0 ||
    !allowedScopes.has(scope as MemoryScope) ||
    !allowedStates.has(state as MemoryRecordState)
  ) {
    return null;
  }

  return {
    ref,
    scope: scope as MemoryScope,
    state: state as MemoryRecordState,
    topic,
    id
  };
}

export function assertValidMemoryRef(ref: string): MemoryRef {
  const parsed = parseMemoryRef(ref);
  if (!parsed) {
    throw new Error(
      `Invalid memory ref "${ref}". Expected format <scope>:<state>:<topic>:<id>.`
    );
  }

  return parsed;
}

export function isMemoryHistoryRecordState(value: unknown): value is MemoryHistoryRecordState {
  return typeof value === "string" && allowedHistoryStates.has(value as MemoryHistoryRecordState);
}

function normalizeString(value: string | undefined): string {
  return (value ?? "").trim();
}

function normalizeStringArray(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean);
}

export function areEquivalentMemoryEntries(left: MemoryEntry, right: MemoryEntry): boolean {
  return (
    normalizeString(left.summary) === normalizeString(right.summary) &&
    JSON.stringify(normalizeStringArray(left.details)) ===
      JSON.stringify(normalizeStringArray(right.details)) &&
    JSON.stringify(normalizeStringArray(left.sources)) ===
      JSON.stringify(normalizeStringArray(right.sources)) &&
    normalizeString(left.reason) === normalizeString(right.reason)
  );
}

function hasSemanticMemoryEntryDiff(left: MemoryEntry, right: MemoryEntry): boolean {
  return (
    normalizeString(left.summary) !== normalizeString(right.summary) ||
    JSON.stringify(normalizeStringArray(left.details)) !==
      JSON.stringify(normalizeStringArray(right.details))
  );
}

function hasMetadataMemoryEntryDiff(left: MemoryEntry, right: MemoryEntry): boolean {
  return (
    JSON.stringify(normalizeStringArray(left.sources)) !==
      JSON.stringify(normalizeStringArray(right.sources)) ||
    normalizeString(left.reason) !== normalizeString(right.reason)
  );
}

export function classifyUpdateKind(
  existingActive: MemoryEntry,
  nextEntry: MemoryEntry
): Extract<MemoryLifecycleUpdateKind, "semantic-overwrite" | "metadata-only"> {
  if (hasSemanticMemoryEntryDiff(existingActive, nextEntry)) {
    return "semantic-overwrite";
  }

  if (hasMetadataMemoryEntryDiff(existingActive, nextEntry)) {
    return "metadata-only";
  }

  return "semantic-overwrite";
}

export function classifyUpsertLifecycle(
  existingActive: MemoryEntry | null,
  existingArchived: MemoryEntry | null,
  nextEntry: MemoryEntry
): Extract<MemoryLifecycleAction, "add" | "update" | "restore" | "noop"> {
  if (existingActive && areEquivalentMemoryEntries(existingActive, nextEntry)) {
    return "noop";
  }

  if (existingArchived && !existingActive) {
    return "restore";
  }

  return existingActive ? "update" : "add";
}

export function nextHistoryStateForLifecycle(
  action: MemoryLifecycleAction
): MemoryHistoryRecordState | undefined {
  switch (action) {
    case "add":
    case "update":
    case "restore":
      return "active";
    case "archive":
      return "archived";
    case "delete":
      return "deleted";
    case "noop":
      return undefined;
  }
}
