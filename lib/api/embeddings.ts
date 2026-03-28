import { GoogleGenerativeAI } from "@google/generative-ai";
import { aiError } from "./errors";

/**
 * Generate embeddings for one or more texts using Google's text-embedding-004 model.
 * Returns array of 768-dimensional float arrays.
 */
export async function generateEmbeddings(
  apiKey: string,
  texts: string[]
): Promise<number[][]> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

    // Batch in groups of 100 (API limit)
    const results: number[][] = [];
    const batchSize = 100;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await model.batchEmbedContents({
        requests: batch.map((text) => ({
          content: { role: "user", parts: [{ text }] },
        })),
      });

      for (const embedding of response.embeddings) {
        results.push(embedding.values);
      }
    }

    return results;
  } catch (err: any) {
    if (err.message?.includes("API key")) {
      throw aiError("Invalid Google AI API key. Please check your key in Settings.");
    }
    throw aiError(`Embedding generation failed: ${err.message}`);
  }
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
      } catch (err: any) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`
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
  } catch (err: any) {
    throw aiError(`Text generation failed: ${err.message}`);
  }
}
