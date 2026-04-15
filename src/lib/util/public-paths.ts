import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface PublicPathRoot {
  label: string;
  path: string;
}

export interface PublicPathContext {
  projectRoot?: string;
  memoryRoot?: string;
  cwd?: string;
  homeDir?: string;
  extraRoots?: PublicPathRoot[];
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function normalizeForCompare(value: string): string {
  const normalized = normalizePath(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInsideRoot(candidate: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRoots(context: PublicPathContext): PublicPathRoot[] {
  const roots: PublicPathRoot[] = [
    ...(context.projectRoot ? [{ label: "<project-root>", path: context.projectRoot }] : []),
    ...(context.memoryRoot ? [{ label: "<memory-root>", path: context.memoryRoot }] : []),
    ...(context.cwd ? [{ label: "<cwd>", path: context.cwd }] : []),
    {
      label: "<home>",
      path: context.homeDir ?? os.homedir()
    },
    ...(context.extraRoots ?? [])
  ];

  return roots
    .map((root) => ({
      label: root.label,
      path: normalizePath(root.path)
    }))
    .filter((root, index, items) =>
      items.findIndex(
        (candidate) =>
          candidate.label === root.label &&
          normalizeForCompare(candidate.path) === normalizeForCompare(root.path)
      ) === index
    )
    .sort((left, right) => right.path.length - left.path.length);
}

export function sanitizePublicPath(
  input: string | null | undefined,
  context: PublicPathContext
): string | null {
  if (!input) {
    return input ?? null;
  }

  if (!path.isAbsolute(input)) {
    return input;
  }

  const normalizedInput = normalizePath(input);
  for (const root of normalizeRoots(context)) {
    if (!isInsideRoot(normalizedInput, root.path)) {
      continue;
    }

    const relative = path.relative(root.path, normalizedInput);
    return relative ? path.join(root.label, relative) : root.label;
  }

  return path.join("<absolute-path>", path.basename(normalizedInput));
}

export function sanitizePublicPathList(
  inputs: string[],
  context: PublicPathContext
): string[] {
  return inputs.map((input) => sanitizePublicPath(input, context) ?? input);
}

export function sanitizeKnownPathsInText(
  text: string,
  paths: string[],
  context: PublicPathContext
): string {
  let next = text;
  const sortedPaths = [...new Set(paths.filter((value) => path.isAbsolute(value)))].sort(
    (left, right) => right.length - left.length
  );

  for (const originalPath of sortedPaths) {
    const sanitizedPath = sanitizePublicPath(originalPath, context);
    if (!sanitizedPath || sanitizedPath === originalPath) {
      continue;
    }

    next = next.split(originalPath).join(sanitizedPath);
  }

  return next;
}

function isPathLikeKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return (
    lowerKey === "path" ||
    lowerKey === "cwd" ||
    lowerKey.endsWith("path") ||
    lowerKey.endsWith("dir") ||
    lowerKey.endsWith("root")
  );
}

function isPathCollectionKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return (
    lowerKey.endsWith("paths") ||
    lowerKey.endsWith("dirs") ||
    lowerKey.endsWith("files") ||
    lowerKey.endsWith("targets")
  );
}

export function sanitizePathFieldsDeep<T>(
  value: T,
  context: PublicPathContext,
  parentKey?: string
): T {
  if (Array.isArray(value)) {
    if (parentKey && isPathCollectionKey(parentKey)) {
      return value.map((item) =>
        typeof item === "string" ? sanitizePublicPath(item, context) ?? item : item
      ) as T;
    }

    return value.map((item) => sanitizePathFieldsDeep(item, context)) as T;
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string" && parentKey && isPathLikeKey(parentKey)) {
      return (sanitizePublicPath(value, context) ?? value) as T;
    }

    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sanitizePathFieldsDeep(item, context, key)
    ])
  ) as T;
}
