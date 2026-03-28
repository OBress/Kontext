export interface AiHealthCheckResult {
  generationStatus: "ok" | "error";
  embeddingStatus: "ok" | "error";
  generationModel: string;
  embeddingModel: string;
  failureCode: string | null;
  action: string | null;
  generationError?: {
    code: string;
    message: string;
    action?: string;
  } | null;
  embeddingError?: {
    code: string;
    message: string;
    action?: string;
  } | null;
}

export async function testGoogleAiKey(
  apiKey: string
): Promise<AiHealthCheckResult> {
  const response = await fetch("/api/settings/ai-health", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-google-api-key": apiKey,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Failed to test Google AI key");
  }

  return data as AiHealthCheckResult;
}
