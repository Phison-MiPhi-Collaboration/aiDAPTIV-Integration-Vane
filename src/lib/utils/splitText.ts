import { getEncoding } from 'js-tiktoken';

const splitRegex = /(?<=\. |\n|! |\? |; |:\s|\d+\.\s|- |\* )/g;

const enc = getEncoding('cl100k_base');

// Treat special-token strings like <|endoftext|> as plain text instead of throwing.
const encodeText = (text: string): number[] => enc.encode(text, [], []);

export const getTokenCount = (text: string): number => {
  try {
    return encodeText(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
};

// Text with no sentence breaks (minified JSON, long lines) yields segments
// larger than maxTokens; hard-split those so the chunking loop always advances.
const splitOversizedSegment = (segment: string, maxTokens: number): string[] => {
  const tokens = encodeText(segment);

  if (tokens.length <= maxTokens) {
    return [segment];
  }

  const parts: string[] = [];

  for (let i = 0; i < tokens.length; i += maxTokens) {
    parts.push(enc.decode(tokens.slice(i, i + maxTokens)));
  }

  return parts;
};

export const splitText = (
  text: string,
  maxTokens = 512,
  overlapTokens = 64,
): string[] => {
  const segments = text
    .split(splitRegex)
    .filter(Boolean)
    .flatMap((segment) => splitOversizedSegment(segment, maxTokens));

  if (segments.length === 0) {
    return [];
  }

  const segmentTokenCounts = segments.map(getTokenCount);

  const result: string[] = [];

  let chunkStart = 0;

  while (chunkStart < segments.length) {
    let chunkEnd = chunkStart;
    let currentTokenCount = 0;

    while (chunkEnd < segments.length && currentTokenCount < maxTokens) {
      if (currentTokenCount + segmentTokenCounts[chunkEnd] > maxTokens) {
        break;
      }

      currentTokenCount += segmentTokenCounts[chunkEnd];
      chunkEnd++;
    }

    // Safety net: never loop without consuming at least one segment.
    if (chunkEnd === chunkStart) {
      chunkEnd++;
    }

    let overlapBeforeStart = Math.max(0, chunkStart - 1);
    let overlapBeforeTokenCount = 0;

    while (overlapBeforeStart >= 0 && overlapBeforeTokenCount < overlapTokens) {
      if (
        overlapBeforeTokenCount + segmentTokenCounts[overlapBeforeStart] >
        overlapTokens
      ) {
        break;
      }

      overlapBeforeTokenCount += segmentTokenCounts[overlapBeforeStart];
      overlapBeforeStart--;
    }

    const overlapStartIndex = Math.max(0, overlapBeforeStart + 1);

    const overlapBeforeContent = segments
      .slice(overlapStartIndex, chunkStart)
      .join('');

    const chunkContent = segments.slice(chunkStart, chunkEnd).join('');

    result.push(overlapBeforeContent + chunkContent);

    chunkStart = chunkEnd;
  }

  return result;
};
