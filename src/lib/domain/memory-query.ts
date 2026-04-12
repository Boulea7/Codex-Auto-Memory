function normalizeMemoryQueryTerm(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/gu, "")
    .replace(/[^\p{L}\p{N}]+$/gu, "");
}

export function normalizeMemoryQueryTerms(query: string): string[] {
  return query
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .map((term) => normalizeMemoryQueryTerm(term))
    .filter(Boolean);
}

export function matchesAllMemoryQueryTerms(
  haystack: string,
  queryOrTerms: string | readonly string[]
): boolean {
  const normalizedTerms =
    typeof queryOrTerms === "string"
      ? normalizeMemoryQueryTerms(queryOrTerms)
      : queryOrTerms
          .map((term) => normalizeMemoryQueryTerm(term))
          .filter(Boolean);
  if (normalizedTerms.length === 0) {
    return false;
  }

  const normalizedHaystack = haystack.toLowerCase();
  return normalizedTerms.every((term) => normalizedHaystack.includes(term));
}
