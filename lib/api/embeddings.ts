import type {
  GenerateContentConfig,
  Schema,
} from "@google/genai";
import { ApiError } from "./errors";
import {
  createGeminiClient,
  delay,
  GEMINI_EMBEDDING_BATCH_SIZE,
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_GENERATION_MODEL,
  normalizeGeminiError,
} from "./gemini";

// ── Global embedding mutex ──────────────────────────────────────────
// Ensures only one embedding operation runs at a time across all
// concurrent ingests/syncs, preventing TPM quota thrashing.
let embeddingLock: Promise<void> = Promise.resolve();
let embeddingLockRelease: (() => void) | null = null;

function acquireEmbeddingLock(): Promise<() => void> {
  return new Promise<() => void>((resolveAcquire) => {
    const prev = embeddingLock;
    let release: () => void;
    embeddingLock = new Promise<void>((resolveLock) => {
      release = () => {
        embeddingLockRelease = null;
        resolveLock();
      };
    });
    prev.then(() => {
      embeddingLockRelease = release!;
      resolveAcquire(release!);
    });
  });
}
import {
  buildTaskSystemInstruction,
  PROMPT_GENERATION_CONFIGS,
} from "./prompt-contract";

interface EmbeddingOptions {
  onBatchComplete?: (completed: number, total: number) => void;
  onRetry?: (message: string) => void;
}

export interface TextGenerationOptions {
  systemInstruction?: string;
  generationConfig?: Partial<GenerateContentConfig>;
}

export interface StructuredJsonGenerationOptions<T>
  extends TextGenerationOptions {
  responseSchema: Schema;
  validate?: (value: unknown) => value is T;
  transform?: (value: unknown) => T;
  maxAttempts?: number;
}

function normalizeGenerationOptions(
  options?: string | TextGenerationOptions
): TextGenerationOptions {
  if (typeof options === "string") {
    return { systemInstruction: options };
  }

  return options || {};
}

/**
 * Convert a Schema object (with Type enum values) to plain JSON Schema.
 * The @google/genai JS SDK expects `responseJsonSchema` with standard
 * JSON Schema, not `responseSchema` with proprietary Type enums.
 */
function schemaToJsonSchema(schema: Schema): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (schema.type) {
    // Type enum values like "STRING" need to map to lowercase JSON Schema types
    const typeMap: Record<string, string> = {
      STRING: "string",
      NUMBER: "number",
      INTEGER: "integer",
      BOOLEAN: "boolean",
      OBJECT: "object",
      ARRAY: "array",
    };
    result.type = typeMap[schema.type] || schema.type.toLowerCase();
  }

  if (schema.format && schema.format !== "enum") result.format = schema.format;
  if (schema.enum) result.enum = schema.enum;
  if (schema.description) result.description = schema.description;
  if (schema.required) result.required = schema.required;

  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      props[key] = schemaToJsonSchema(value as Schema);
    }
    result.properties = props;
  }

  if (schema.items) {
    result.items = schemaToJsonSchema(schema.items as Schema);
  }

  if (schema.minItems) result.minItems = Number(schema.minItems);
  if (schema.maxItems) result.maxItems = Number(schema.maxItems);

  return result;
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ApiError(
      502,
      "AI_PARSE_ERROR",
      "Gemini returned an empty structured response."
    );
  }

  const cleaned = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return JSON.parse(cleaned);
}

/**
 * Generate embeddings for one or more texts using Google's gemini-embedding-001 model.
 * Returns array of 1536-dimensional float arrays.
 *
 * Uses taskType to optimize embeddings for their intended use:
 * - RETRIEVAL_DOCUMENT: when embedding source code / documents for storage
 * - CODE_RETRIEVAL_QUERY: when embedding a user's search query about code
 * - RETRIEVAL_QUERY: when embedding a general search query
 */
export async function generateEmbeddings(
  apiKey: string,
  texts: string[],
  taskType: string = "RETRIEVAL_DOCUMENT",
  options: EmbeddingOptions = {}
): Promise<number[][]> {
  // Acquire global lock — only one embedding operation at a time
  const release = await acquireEmbeddingLock();

  try {
    const ai = createGeminiClient(apiKey);
    const results: number[][] = [];

    // Greedy strategy: fire as fast as possible, let the API tell us
    // when to stop. On rate limit, wait 60s and retry (max 2 retries).
    const MAX_RETRIES = 2;

    const totalBatches = Math.ceil(texts.length / GEMINI_EMBEDDING_BATCH_SIZE);

    for (let i = 0; i < texts.length; i += GEMINI_EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(i, i + GEMINI_EMBEDDING_BATCH_SIZE);
      const batchNum = Math.floor(i / GEMINI_EMBEDDING_BATCH_SIZE) + 1;
      let attempts = 0;

      while (true) {
        try {
          const response = await ai.models.embedContent({
            model: GEMINI_EMBEDDING_MODEL,
            contents: batch,
            config: {
              taskType,
              outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
            },
          });

          if (response.embeddings) {
            for (const embedding of response.embeddings) {
              results.push(embedding.values || []);
            }
          }

          options.onBatchComplete?.(results.length, texts.length);
          break;
        } catch (error: unknown) {
          const normalized = normalizeGeminiError(error, "embedding");
          const isQuotaError = normalized.code === "AI_QUOTA_EXCEEDED";
          const isTransientError = normalized.code === "AI_TRANSIENT";
          const canRetry = (isQuotaError || isTransientError) && attempts < MAX_RETRIES;

          if (!canRetry) {
            throw normalized;
          }

          attempts += 1;

          // Wait 60s for quota reset (TPM resets per minute)
          const backoff = 60_000 + Math.random() * 5000;
          const waitSec = Math.round(backoff / 1000);
          console.warn(
            `[embeddings] ${isQuotaError ? "TPM quota" : "Rate limit"} hit on batch ${batchNum}/${totalBatches}, ` +
            `waiting ${waitSec}s (attempt ${attempts}/${MAX_RETRIES})`
          );
          options.onRetry?.(
            `Rate limit reached — waiting ${waitSec}s for cooldown (attempt ${attempts}/${MAX_RETRIES})...`
          );

          await delay(backoff);
        }
      }

      // No delay between successful batches — go full speed
    }

    return results;
  } finally {
    release();
  }
}

/**
 * Generate embeddings optimized for retrieval queries.
 *
 * Use "CODE_RETRIEVAL_QUERY" when the query is a natural language
 * question about code (e.g. "list all API endpoints"). This aligns the
 * query embedding with RETRIEVAL_DOCUMENT code chunks for better recall.
 */
export async function generateQueryEmbedding(
  apiKey: string,
  query: string,
  taskType: string = "RETRIEVAL_QUERY"
): Promise<number[]> {
  const results = await generateEmbeddings(apiKey, [query], taskType);
  return results[0];
}

/**
 * Generate a streaming chat response from Gemini.
 * Returns a ReadableStream that emits text chunks.
 */
export async function generateChatStream(
  apiKey: string,
  userMessage: string,
  options?: string | TextGenerationOptions
): Promise<ReadableStream<Uint8Array>> {
  const normalizedOptions = normalizeGenerationOptions(options);
  const ai = createGeminiClient(apiKey);

  const response = await ai.models.generateContentStream({
    model: GEMINI_GENERATION_MODEL,
    contents: userMessage,
    config: {
      ...(normalizedOptions.systemInstruction
        ? { systemInstruction: normalizedOptions.systemInstruction }
        : {}),
      ...(normalizedOptions.generationConfig || {}),
    },
  });

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of response) {
          const text = chunk.text;
          if (text) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "text", content: text })}\n\n`
              )
            );
          }
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      } catch (err: unknown) {
        const message = normalizeGeminiError(err, "generation").message;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message })}\n\n`
          )
        );
        controller.close();
      }
    },
  });
}

/**
 * Generate a streaming chat response with multimodal content (text + images).
 * Accepts an array of parts for the user message.
 */
export async function generateMultimodalChatStream(
  apiKey: string,
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
  options?: string | TextGenerationOptions
): Promise<ReadableStream<Uint8Array>> {
  const normalizedOptions = normalizeGenerationOptions(options);
  const ai = createGeminiClient(apiKey);

  const response = await ai.models.generateContentStream({
    model: GEMINI_GENERATION_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      ...(normalizedOptions.systemInstruction
        ? { systemInstruction: normalizedOptions.systemInstruction }
        : {}),
      ...(normalizedOptions.generationConfig || {}),
    },
  });

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of response) {
          const text = chunk.text;
          if (text) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "text", content: text })}\n\n`
              )
            );
          }
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      } catch (err: unknown) {
        const message = normalizeGeminiError(err, "generation").message;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message })}\n\n`
          )
        );
        controller.close();
      }
    },
  });
}

/**
 * Generate a complete text response (non-streaming) from Gemini.
 */
export async function generateText(
  apiKey: string,
  prompt: string,
  options?: string | TextGenerationOptions
): Promise<string> {
  try {
    const normalizedOptions = normalizeGenerationOptions(options);
    const ai = createGeminiClient(apiKey);

    const config = {
      ...(normalizedOptions.systemInstruction
        ? { systemInstruction: normalizedOptions.systemInstruction }
        : {}),
      ...(normalizedOptions.generationConfig || {}),
    };

    const result = await ai.models.generateContent({
      model: GEMINI_GENERATION_MODEL,
      contents: prompt,
      config,
    });

    return result.text ?? "";
  } catch (err: unknown) {
    throw normalizeGeminiError(err, "generation");
  }
}

export async function generateStructuredJson<T>(
  apiKey: string,
  prompt: string,
  options: StructuredJsonGenerationOptions<T>
): Promise<T> {
  const maxAttempts = options.maxAttempts || 2;

  const generationConfig: Partial<GenerateContentConfig> = {
    ...options.generationConfig,
    responseMimeType: "application/json",
  };

  let lastError: unknown = null;
  let attemptPrompt = prompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`[generateStructuredJson] Attempt ${attempt}/${maxAttempts}, model: ${GEMINI_GENERATION_MODEL}`);
      const ai = createGeminiClient(apiKey);
      const result = await ai.models.generateContent({
        model: GEMINI_GENERATION_MODEL,
        contents: attemptPrompt,
        config: {
          ...(options.systemInstruction
            ? { systemInstruction: options.systemInstruction }
            : {}),
          ...generationConfig,
        },
      });

      const raw = result.text ?? "";
      console.log(`[generateStructuredJson] Success, response length: ${raw.length}`);
      const parsed = parseJsonResponse(raw);

      if (options.transform) {
        return options.transform(parsed);
      }

      if (options.validate && !options.validate(parsed)) {
        throw new ApiError(
          502,
          "AI_PARSE_ERROR",
          "Gemini returned structured JSON that did not match the expected shape."
        );
      }

      return parsed as T;
    } catch (error: unknown) {
      console.error(`[generateStructuredJson] Attempt ${attempt} failed:`, {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message?.slice(0, 300) : String(error).slice(0, 300),
        status: (error as Record<string, unknown>)?.status,
      });
      lastError = error;
      if (attempt >= maxAttempts) break;

      attemptPrompt = `${prompt}\n\nIMPORTANT: Return only valid JSON that matches the requested schema. Do not use markdown fences.`;
    }
  }

  if (lastError instanceof ApiError) {
    throw lastError;
  }

  throw new ApiError(
    502,
    "AI_PARSE_ERROR",
    "Gemini did not return valid structured JSON."
  );
}

/**
 * Generate LLM file summaries for Deep Dive tier (Tier 3).
 * Produces a concise 2-3 sentence summary of what a code file does.
 */
export async function generateFileSummary(
  apiKey: string,
  filePath: string,
  content: string
): Promise<string> {
  const prompt = `Analyze this partial source code file excerpt and provide a concise 2-3 sentence summary of what it appears to do, its likely key exports, and its role in the project.

File: ${filePath}

\`\`\`
${content.slice(0, 4000)}
\`\`\`

Only describe behavior that is visible in the excerpt. If the excerpt is incomplete, say so briefly.

Summary:`;

  return generateText(apiKey, prompt, {
    systemInstruction: buildTaskSystemInstruction({
      task: "high_signal_compressor",
      role: "a senior software engineer",
      mission:
        "Produce concise technical file summaries from partial source excerpts.",
      outputStyle: [
        "Keep the summary to 2-3 sentences.",
        "Use technical language without filler.",
        "State when the excerpt appears partial instead of assuming missing details.",
      ],
    }),
    generationConfig: PROMPT_GENERATION_CONFIGS.summary,
  });
}
