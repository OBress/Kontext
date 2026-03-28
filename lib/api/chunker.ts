export interface Chunk {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  metadata: {
    startLine: number;
    endLine: number;
  };
}

const TARGET_CHUNK_SIZE = 2000; // ~500 tokens
const OVERLAP = 100;

// Patterns that indicate natural code boundaries
const BOUNDARY_PATTERNS = [
  /^(?:export\s+)?(?:async\s+)?function\s+/,
  /^(?:export\s+)?class\s+/,
  /^(?:export\s+)?interface\s+/,
  /^(?:export\s+)?type\s+/,
  /^(?:export\s+)?const\s+\w+\s*=/,
  /^(?:export\s+)?enum\s+/,
  /^def\s+/,           // Python
  /^class\s+/,         // Python
  /^func\s+/,          // Go
  /^pub\s+(?:fn|struct|enum|trait)\s+/, // Rust
];

function isBoundary(line: string): boolean {
  const trimmed = line.trimStart();
  return BOUNDARY_PATTERNS.some((p) => p.test(trimmed));
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for code
  return Math.ceil(text.length / 4);
}

/**
 * Split file content into chunks, preferring code boundaries.
 */
export function chunkFile(content: string, filePath: string): Chunk[] {
  const lines = content.split("\n");

  // Small files: single chunk
  if (content.length <= TARGET_CHUNK_SIZE) {
    return [
      {
        content: `// File: ${filePath}\n${content}`,
        chunkIndex: 0,
        tokenCount: estimateTokens(content),
        metadata: { startLine: 1, endLine: lines.length },
      },
    ];
  }

  const chunks: Chunk[] = [];
  let currentLines: string[] = [];
  let currentStart = 1;
  let currentSize = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineSize = line.length + 1; // +1 for newline

    // Check if we should split here
    const shouldSplit =
      currentSize + lineSize > TARGET_CHUNK_SIZE &&
      currentLines.length > 0 &&
      (isBoundary(line) || currentSize > TARGET_CHUNK_SIZE * 1.5);

    if (shouldSplit) {
      const chunkContent = `// File: ${filePath}\n${currentLines.join("\n")}`;
      chunks.push({
        content: chunkContent,
        chunkIndex: chunks.length,
        tokenCount: estimateTokens(chunkContent),
        metadata: {
          startLine: currentStart,
          endLine: currentStart + currentLines.length - 1,
        },
      });

      // Overlap: keep last few lines for context
      const overlapLines = Math.min(
        3,
        Math.floor(OVERLAP / (currentSize / currentLines.length || 40))
      );
      const kept = currentLines.slice(-overlapLines);
      currentLines = kept;
      currentStart = i + 1 - overlapLines;
      currentSize = kept.join("\n").length;
    }

    currentLines.push(line);
    currentSize += lineSize;
  }

  // Final chunk
  if (currentLines.length > 0) {
    const chunkContent = `// File: ${filePath}\n${currentLines.join("\n")}`;
    chunks.push({
      content: chunkContent,
      chunkIndex: chunks.length,
      tokenCount: estimateTokens(chunkContent),
      metadata: {
        startLine: currentStart,
        endLine: currentStart + currentLines.length - 1,
      },
    });
  }

  return chunks;
}
