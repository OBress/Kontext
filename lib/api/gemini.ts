import { GoogleGenAI } from "@google/genai";
import { ApiError, type ApiErrorPayload } from "./errors";

export const GEMINI_GENERATION_MODEL = "gemini-3.1-flash-lite-preview";
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
export const GEMINI_EMBEDDING_DIMENSIONS = 1536;
export const GEMINI_EMBEDDING_BATCH_SIZE = 20;
export const GEMINI_EMBEDDING_BATCH_DELAY_MS = 750;

export type AiFailureCode =
  | "AI_QUOTA_EXCEEDED"
  | "AI_BILLING_REQUIRED"
  | "AI_MODEL_UNAVAILABLE"
  | "AI_AUTH_INVALID"
  | "AI_TRANSIENT";

export interface GeminiHealthCheck {
  generationStatus: "ok" | "error";
  embeddingStatus: "ok" | "error";
  generationModel: string;
  embeddingModel: string;
  failureCode: AiFailureCode | null;
  action: string | null;
  generationError?: ApiErrorPayload | null;
  embeddingError?: ApiErrorPayload | null;
}

function getMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

function getProviderStatus(message: string): number | null {
  const match = message.match(/\[(\d{3})\s+[^\]]+\]/);
  return match ? Number(match[1]) : null;
}

function getOperationLabel(operation: "embedding" | "generation"): string {
  return operation === "embedding" ? "embedding generation" : "text generation";
}

function getRetryHint(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("retry") || lower.includes("temporar") || lower.includes("unavailable");
}

export function getAiBlockedStatus(
  code: string
): "blocked_quota" | "blocked_billing" | "blocked_model" | null {
  switch (code) {
    case "AI_QUOTA_EXCEEDED":
      return "blocked_quota";
    case "AI_BILLING_REQUIRED":
      return "blocked_billing";
    case "AI_MODEL_UNAVAILABLE":
      return "blocked_model";
    default:
      return null;
  }
}

export function normalizeGeminiError(
  error: unknown,
  operation: "embedding" | "generation"
): ApiError {
  if (error instanceof ApiError) return error;

  const message = getMessage(error);
  const lower = message.toLowerCase();
  const providerStatus = getProviderStatus(message);
  const operationLabel = getOperationLabel(operation);

  // Also check for .status on the error object (new SDK exposes this)
  const errorStatus =
    typeof (error as Record<string, unknown>)?.status === "number"
      ? ((error as Record<string, unknown>).status as number)
      : null;
  const effectiveStatus = providerStatus ?? errorStatus;

  if (
    effectiveStatus === 401 ||
    lower.includes("api key not valid") ||
    lower.includes("invalid api key") ||
    lower.includes("permission denied")
  ) {
    return new ApiError(
      401,
      "AI_AUTH_INVALID",
      "The Google AI API key is invalid, expired, or does not have access to Gemini for this project.",
      {
        recoverable: true,
        action: "Verify your Google AI API key in Settings and re-test the connection.",
      }
    );
  }

  if (
    effectiveStatus === 404 ||
    (lower.includes("model") &&
      (lower.includes("not found") || lower.includes("unsupported") || lower.includes("unavailable")))
  ) {
    return new ApiError(
      400,
      "AI_MODEL_UNAVAILABLE",
      `The configured Gemini model for ${operationLabel} is unavailable for this Google project.`,
      {
        recoverable: false,
        action: "Verify that this Google project has access to the configured Gemini model and try the connection test again.",
      }
    );
  }

  if (
    effectiveStatus === 403 &&
    (lower.includes("billing") ||
      lower.includes("payment") ||
      lower.includes("cloud billing") ||
      lower.includes("plan"))
  ) {
    return new ApiError(
      402,
      "AI_BILLING_REQUIRED",
      `The Google project behind this API key needs active billing before ${operationLabel} can run.`,
      {
        recoverable: true,
        action: "Enable billing for the Google project behind this key, wait for it to become active, then retry.",
      }
    );
  }

  if (effectiveStatus === 429) {
    // Only classify as a hard quota block if the error message
    // explicitly mentions "quota" — this separates genuine quota
    // exhaustion from per-minute rate limiting that can be retried.
    const isHardQuota =
      lower.includes("quota") &&
      (lower.includes("exceeded") || lower.includes("exhausted") || lower.includes("limit"));

    if (isHardQuota) {
      return new ApiError(
        429,
        "AI_QUOTA_EXCEEDED",
        `The Google project behind this API key has hit its Gemini quota for ${operationLabel}.`,
        {
          recoverable: true,
          action: "Retry later, or verify quota and billing for the Google project behind this key in AI Studio / Google Cloud.",
        }
      );
    }

    // All other 429s are transient rate limits — the caller should
    // back off and retry.
    return new ApiError(
      503,
      "AI_TRANSIENT",
      `Gemini rate-limited ${operationLabel}. Will retry automatically.`,
      {
        recoverable: true,
        action: "Retry in a moment. If this keeps happening, verify project quota and service status.",
      }
    );
  }

  return new ApiError(
    502,
    "AI_TRANSIENT",
    `Gemini failed during ${operationLabel}.`,
    {
      recoverable: true,
      action: "Retry the operation. If it continues failing, re-test the key and verify model access.",
    }
  );
}

export async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGeminiClient(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

export async function runGeminiHealthCheck(
  apiKey: string
): Promise<GeminiHealthCheck> {
  const ai = createGeminiClient(apiKey);

  let generationError: ApiErrorPayload | null = null;
  let embeddingError: ApiErrorPayload | null = null;

  try {
    await ai.models.generateContent({
      model: GEMINI_GENERATION_MODEL,
      contents: "OK",
      config: {
        systemInstruction: "Reply with the single token OK.",
      },
    });
  } catch (error: unknown) {
    const normalized = normalizeGeminiError(error, "generation");
    generationError = {
      code: normalized.code,
      message: normalized.message,
      ...normalized.details,
    };
  }

  try {
    await ai.models.embedContent({
      model: GEMINI_EMBEDDING_MODEL,
      contents: "health check",
      config: {
        taskType: "RETRIEVAL_QUERY",
      },
    });
  } catch (error: unknown) {
    const normalized = normalizeGeminiError(error, "embedding");
    embeddingError = {
      code: normalized.code as AiFailureCode,
      message: normalized.message,
      ...normalized.details,
    };
  }

  const firstFailure = generationError || embeddingError;

  return {
    generationStatus: generationError ? "error" : "ok",
    embeddingStatus: embeddingError ? "error" : "ok",
    generationModel: GEMINI_GENERATION_MODEL,
    embeddingModel: GEMINI_EMBEDDING_MODEL,
    failureCode: (firstFailure?.code as AiFailureCode | undefined) || null,
    action:
      typeof firstFailure?.action === "string" ? firstFailure.action : null,
    generationError,
    embeddingError,
  };
}
