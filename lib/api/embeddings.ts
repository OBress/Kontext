import type {
  GenerationConfig,
  Part,
  ResponseSchema,
} from "@google/generative-ai";
import { TaskType } from "@google/generative-ai";
import { ApiError } from "./errors";
import {
  createGeminiClient,
  delay,
  GEMINI_EMBEDDING_BATCH_DELAY_MS,
  GEMINI_EMBEDDING_BATCH_SIZE,
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_GENERATION_MODEL,
  normalizeGeminiError,
} from "./gemini";
import {
  buildTaskSystemInstruction,
  PROMPT_GENERATION_CONFIGS,
} from "./prompt-contract";

interface EmbeddingOptions {
  onBatchComplete?: (completed: number, total: number) => void;
}

export interface TextGenerationOptions {
  systemInstruction?: string;
  generationConfig?: GenerationConfig;
}

export interface StructuredJsonGenerationOptions<T>
  extends TextGenerationOptions {
  responseSchema: ResponseSchema;
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
 * Uses TaskType to optimize embeddings for their intended use:
 * - RETRIEVAL_DOCUMENT: when embedding source code / documents for storage
 * - CODE_RETRIEVAL_QUERY: when embedding a user's search query about code
 * - RETRIEVAL_QUERY: when embedding a general search query
 */
export async function generateEmbeddings(
  apiKey: string,
  texts: string[],
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT,
  options: EmbeddingOptions = {}
): Promise<number[][]> {
  const genAI = createGeminiClient(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_EMBEDDING_MODEL });
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += GEMINI_EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + GEMINI_EMBEDDING_BATCH_SIZE);
    let attempts = 0;

    while (true) {
      try {
        const response = await model.batchEmbedContents({
          requests: batch.map((text) => ({
            content: { role: "user", parts: [{ text }] },
            taskType,
            outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
          })),
        });

        for (const embedding of response.embeddings) {
          results.push(embedding.values);
        }

        options.onBatchComplete?.(results.length, texts.length);
        break;
      } catch (error: unknown) {
        const normalized = normalizeGeminiError(error, "embedding");
        const shouldRetry =
          normalized.code === "AI_TRANSIENT" && attempts === 0;

        if (!shouldRetry) {
          throw normalized;
        }

        attempts += 1;
        await delay(GEMINI_EMBEDDING_BATCH_DELAY_MS);
      }
    }

    const hasMore = i + GEMINI_EMBEDDING_BATCH_SIZE < texts.length;
    if (hasMore) {
      await delay(GEMINI_EMBEDDING_BATCH_DELAY_MS);
    }
  }

  return results;
}

/**
 * Generate embeddings optimized for retrieval queries.
 *
 * Use TaskType.CODE_RETRIEVAL_QUERY when the query is a natural language
 * question about code (e.g. "list all API endpoints"). This aligns the
 * query embedding with RETRIEVAL_DOCUMENT code chunks for better recall.
 */
export async function generateQueryEmbedding(
  apiKey: string,
  query: string,
  taskType: TaskType = TaskType.RETRIEVAL_QUERY
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
  const genAI = createGeminiClient(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_GENERATION_MODEL,
    ...(normalizedOptions.systemInstruction
      ? { systemInstruction: normalizedOptions.systemInstruction }
      : {}),
    ...(normalizedOptions.generationConfig
      ? { generationConfig: normalizedOptions.generationConfig }
      : {}),
  });

  const result = await model.generateContentStream(userMessage);
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.stream) {
          const text = chunk.text();
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
 * Accepts an array of Gemini Part objects for the user message.
 */
export async function generateMultimodalChatStream(
  apiKey: string,
  parts: Part[],
  options?: string | TextGenerationOptions
): Promise<ReadableStream<Uint8Array>> {
  const normalizedOptions = normalizeGenerationOptions(options);
  const genAI = createGeminiClient(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_GENERATION_MODEL,
    ...(normalizedOptions.systemInstruction
      ? { systemInstruction: normalizedOptions.systemInstruction }
      : {}),
    ...(normalizedOptions.generationConfig
      ? { generationConfig: normalizedOptions.generationConfig }
      : {}),
  });

  const result = await model.generateContentStream({
    contents: [{ role: "user", parts }],
  });
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.stream) {
          const text = chunk.text();
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
    const genAI = createGeminiClient(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_GENERATION_MODEL,
      ...(normalizedOptions.systemInstruction
        ? { systemInstruction: normalizedOptions.systemInstruction }
        : {}),
      ...(normalizedOptions.generationConfig
        ? { generationConfig: normalizedOptions.generationConfig }
        : {}),
    });

    const result = await model.generateContent(prompt);
    return result.response.text();
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
  const generationConfig: GenerationConfig = {
    ...options.generationConfig,
    responseMimeType: "application/json",
    responseSchema: options.responseSchema,
  };

  let lastError: unknown = null;
  let attemptPrompt = prompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const raw = await generateText(apiKey, attemptPrompt, {
        systemInstruction: options.systemInstruction,
        generationConfig,
      });
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
