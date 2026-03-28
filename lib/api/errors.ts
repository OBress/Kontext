import { NextResponse } from "next/server";

export interface ApiErrorDetails {
  recoverable?: boolean;
  action?: string;
  [key: string]: unknown;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  recoverable?: boolean;
  action?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details: ApiErrorDetails = {}
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function unauthorizedError(message = "Authentication required") {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function rateLimitError(resetAt: number) {
  return new ApiError(429, "RATE_LIMITED", `Rate limit exceeded. Retry after ${new Date(resetAt).toISOString()}`);
}

export function validationError(message: string) {
  return new ApiError(400, "VALIDATION_ERROR", message);
}

export function notFoundError(message: string) {
  return new ApiError(404, "NOT_FOUND", message);
}

export function githubError(message: string) {
  return new ApiError(502, "GITHUB_ERROR", message);
}

export function aiError(message: string, details: ApiErrorDetails = {}) {
  return new ApiError(502, "AI_ERROR", message, details);
}

export function getApiErrorPayload(error: unknown): ApiErrorPayload {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      ...error.details,
    };
  }

  // Preserve the real error message for debugging instead of hiding it
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";

  return {
    code: "INTERNAL_ERROR",
    message,
  };
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: getApiErrorPayload(error) }, { status: error.statusCode });
  }

  console.error("[API Error]", error);
  return NextResponse.json({ error: getApiErrorPayload(error) }, { status: 500 });
}
