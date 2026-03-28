import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
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

export function aiError(message: string) {
  return new ApiError(502, "AI_ERROR", message);
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode }
    );
  }

  console.error("[API Error]", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
    { status: 500 }
  );
}
