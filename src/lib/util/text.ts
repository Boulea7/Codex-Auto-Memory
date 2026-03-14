import { createHash } from "node:crypto";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[`"'’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "memory-entry";
}

export function hashId(input: string, size = 12): string {
  return createHash("sha256").update(input).digest("hex").slice(0, size);
}

export function toBulletLines(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}

export function limitLines(input: string, maxLines: number): string {
  const lines = input.split("\n");
  if (lines.length <= maxLines) {
    return input;
  }

  return [...lines.slice(0, Math.max(0, maxLines - 1)), "... (truncated)"].join("\n");
}

export function trimText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, Math.max(0, maxLength - 3))}...`;
}

