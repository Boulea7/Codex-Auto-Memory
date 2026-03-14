import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as toml from "smol-toml";

interface CodexConfigShape {
  base_instructions?: string;
}

export async function readCodexBaseInstructions(): Promise<string> {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = toml.parse(raw) as CodexConfigShape;
    return parsed.base_instructions ?? "";
  } catch {
    return "";
  }
}

export function buildInjectedBaseInstructions(
  existing: string,
  startupMemory: string
): string {
  const header = [
    "The following auto memory was compiled from local, editable markdown files.",
    "Treat it as helpful context and preference notes, not immutable system policy.",
    "If the user corrects any item, prefer the correction.",
    ""
  ].join("\n");

  return [existing.trim(), header, startupMemory.trim()].filter(Boolean).join("\n\n").trim();
}

