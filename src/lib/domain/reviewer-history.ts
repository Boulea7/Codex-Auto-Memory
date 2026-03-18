export interface CompactHistoryGroup<T> {
  latest: T;
  rawCount: number;
}

export interface CompactHistoryPreview<T> {
  groups: CompactHistoryGroup<T>[];
  omittedRawCount: number;
  totalRawCount: number;
}

interface BuildCompactHistoryPreviewOptions<T> {
  getSignature: (entry: T) => string;
  maxGroups?: number;
  excludeLeadingCount?: number;
}

export function buildCompactHistoryPreview<T>(
  entries: T[],
  options: BuildCompactHistoryPreviewOptions<T>
): CompactHistoryPreview<T> {
  const eligibleEntries = entries.slice(options.excludeLeadingCount ?? 0);
  const grouped: Array<CompactHistoryGroup<T> & { signature: string }> = [];

  for (const entry of eligibleEntries) {
    const signature = options.getSignature(entry);
    const previous = grouped.at(-1);
    if (previous?.signature === signature) {
      previous.rawCount += 1;
      continue;
    }

    grouped.push({
      latest: entry,
      rawCount: 1,
      signature
    });
  }

  const limitedGroups = grouped
    .slice(0, options.maxGroups ?? grouped.length)
    .map(({ latest, rawCount }) => ({ latest, rawCount }));
  const shownRawCount = limitedGroups.reduce((sum, group) => sum + group.rawCount, 0);

  return {
    groups: limitedGroups,
    omittedRawCount: Math.max(0, eligibleEntries.length - shownRawCount),
    totalRawCount: eligibleEntries.length
  };
}
