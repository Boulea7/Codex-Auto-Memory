export function canonicalCommandSignature(command: string): string | null {
  const normalized = command.toLowerCase().trim();
  const normalizedCommand = normalized
    .replace(/^(pnpm|npm|bun|yarn)\s+-[cC]\s+\S+\s+/u, "$1 ")
    .replace(/^(pnpm|npm|bun|yarn)\s+exec\s+/u, "")
    .replace(/^uv\s+run\s+/u, "")
    .replace(/^cargo\s+nextest\s+run\b/u, "cargo-nextest run")
    .replace(/^nextest\s+run\b/u, "cargo-nextest run");
  const lifecycleScriptPattern = /^(pnpm|npm|bun|yarn)\s+run\s+(test|lint|build|install|check)\b/u;
  const lifecycleRunMatch = normalizedCommand.match(lifecycleScriptPattern);
  if (lifecycleRunMatch?.[1] && lifecycleRunMatch[2]) {
    return `${lifecycleRunMatch[1]}:${lifecycleRunMatch[2]}`;
  }

  const runScriptMatch = normalizedCommand.match(/^(pnpm|npm|bun|yarn)\s+run\s+([a-z0-9:_-]+)/u);
  if (runScriptMatch?.[1] && runScriptMatch[2]) {
    return `${runScriptMatch[1]}:run:${runScriptMatch[2]}`;
  }

  if (/\b(?:pnpm|npm|bun|yarn)\s+(test|lint|build|install|check)\b/u.test(normalizedCommand)) {
    const match = normalizedCommand.match(/\b(pnpm|npm|bun|yarn)\s+(test|lint|build|install|check)\b/u);
    const tool = match?.[1];
    const action = match?.[2];
    return tool && action ? `${tool}:${action}` : null;
  }

  if (/\bcargo\s+(test|build|check)\b/u.test(normalizedCommand)) {
    const match = normalizedCommand.match(/\bcargo\s+(test|build|check)\b/u);
    const action = match?.[1];
    return action ? `cargo:${action}` : null;
  }

  if (/\bcargo-nextest\s+run\b/u.test(normalizedCommand)) {
    return "cargo-nextest:test";
  }

  if (/\b(?:pytest|jest|vitest|go test|dotnet test|rake)\b/u.test(normalizedCommand)) {
    const match = normalizedCommand.match(/\b(pytest|jest|vitest|go test|dotnet test|rake)\b/u);
    const tool = match?.[1];
    if (!tool) {
      return null;
    }
    return `${tool.replace(/\s+/gu, "-")}:test`;
  }

  if (/\b(?:tsc|vite build|next build|gradle|mvn|make)\b/u.test(normalizedCommand)) {
    const match = normalizedCommand.match(/\b(tsc|vite build|next build|gradle|mvn|make)\b/u);
    const tool = match?.[1];
    if (!tool) {
      return null;
    }
    return `${tool.replace(/\s+/gu, "-")}:build`;
  }

  return null;
}
