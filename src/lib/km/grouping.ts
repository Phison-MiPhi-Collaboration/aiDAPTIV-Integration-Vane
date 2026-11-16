import { getTokenCount, splitText } from '@/lib/utils/splitText';

// Splits a document into consecutive, non-overlapping groups of at most
// maxTokens each, cut at sentence and line breaks. Joining the groups gives
// back the original text. Port of KM's _split_large_file_into_merged_parts.
export const buildGroups = (text: string, maxTokens: number): string[] => {
  if (!text.trim()) {
    return [];
  }

  const groups = splitText(text, maxTokens, 0);

  return balanceLastGroup(groups, maxTokens);
};

// A small last group gets an uneven share of the document. Re-split the last
// two groups into two halves when that keeps both under the limit. Port of
// KM's _try_balance_last_part.
const balanceLastGroup = (groups: string[], maxTokens: number): string[] => {
  if (groups.length < 2) {
    return groups;
  }

  const last = groups[groups.length - 1];
  const previous = groups[groups.length - 2];

  if (getTokenCount(last) >= maxTokens / 2) {
    return groups;
  }

  const combined = previous + last;
  const half = Math.ceil(getTokenCount(combined) / 2);
  const step = Math.max(32, Math.ceil(half * 0.05));

  // Cutting at sentence breaks rarely lands exactly on the half, so a target
  // of exactly half leaves a small third piece. Grow it until two remain.
  for (let target = half; target <= maxTokens; target += step) {
    const rebalanced = splitText(combined, target, 0);

    if (rebalanced.length === 2) {
      return [...groups.slice(0, -2), ...rebalanced];
    }
  }

  return groups;
};
