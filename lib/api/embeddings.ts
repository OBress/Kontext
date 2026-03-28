import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { aiError } from "./errors";

/** Embedding model configuration */
const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate embeddings for one or more texts using Google's gemini-embedding-001 model.
 * Returns array of 3072-dimensional float arrays.
 *
 * Uses TaskType to optimize embeddings for their intended use:
 * - RETRIEVAL_DOCUMENT: when embedding source code / documents for storage
 * - CODE_RETRIEVAL_QUERY: when embedding a user's search query about code
 * - RETRIEVAL_QUERY: when embedding a general search query
 */
export async function generateEmbeddings(
  apiKey: string,
  texts: string[],
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<number[][]> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

    // Batch in groups of 100 (API limit)
    const results: number[][] = [];
    const batchSize = 100;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await model.batchEmbedContents({
        requests: batch.map((text) => ({
          content: { role: "user", parts: [{ text }] },
          taskType,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      });

      for (const embedding of response.embeddings) {
        results.push(embedding.values);
      }
    }

    return results;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("API key")) {
      throw aiError("Invalid Google AI API key. Please check your key in Settings.");
    }
    throw aiError(`Embedding generation failed: ${message}`);
  }
}

/**
 * Generate embeddings optimized for code search queries.
 * Uses CODE_RETRIEVAL_QUERY task type for better retrieval of code blocks.
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
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
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
        const message = err instanceof Error ? err.message : "Unknown error";
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
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      ...(systemInstruction ? { systemInstruction } : {}),
    });

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw aiError(`Text generation failed: ${message}`);
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
