import { TaskType } from "@google/generative-ai";
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

interface EmbeddingOptions {
  onBatchComplete?: (completed: number, total: number) => void;
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
 */
export async function generateQueryEmbedding(
  apiKey: string,
  query: string
): Promise<number[]> {
  const results = await generateEmbeddings(apiKey, [query], TaskType.RETRIEVAL_QUERY);
  return results[0];
}

/**
 * Generate a streaming chat response from Gemini.
 * Returns a ReadableStream that emits text chunks.
 */
export async function generateChatStream(
  apiKey: string,
  systemPrompt: string,
  userMessage: string
): Promise<ReadableStream<Uint8Array>> {
  const genAI = createGeminiClient(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_GENERATION_MODEL,
    systemInstruction: systemPrompt,
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
 * Generate a complete text response (non-streaming) from Gemini.
 */
export async function generateText(
  apiKey: string,
  prompt: string,
  systemInstruction?: string
): Promise<string> {
  try {
    const genAI = createGeminiClient(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_GENERATION_MODEL,
      ...(systemInstruction ? { systemInstruction } : {}),
    });

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err: unknown) {
    throw normalizeGeminiError(err, "generation");
  }
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
  const prompt = `Analyze this source code file and provide a concise 2-3 sentence summary of what it does, its key exports, and its role in the project.

File: ${filePath}

\`\`\`
${content.slice(0, 4000)}
\`\`\`

Summary:`;

  return generateText(apiKey, prompt, "You are a senior software engineer. Provide concise, technical summaries of code files.");
}
