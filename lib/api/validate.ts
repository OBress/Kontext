import { ApiError, validationError } from "./errors";
import { VALID_TARGETS } from "./prompt-types";
import type { PromptTarget } from "./prompt-types";

const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

export function validateRepoFullName(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw validationError("repo_full_name is required");
  }
  const trimmed = input.trim();
  if (!REPO_PATTERN.test(trimmed)) {
    throw validationError("Invalid repo_full_name format. Expected: owner/name");
  }
  if (trimmed.length > 200) {
    throw validationError("repo_full_name is too long");
  }
  return trimmed;
}

export function validateMessage(input: unknown, maxLength = 4000): string {
  if (typeof input !== "string" || !input.trim()) {
    throw validationError("message is required");
  }
  const trimmed = input.trim();
  if (trimmed.length > maxLength) {
    throw validationError(`Message exceeds max length of ${maxLength} characters`);
  }
  return trimmed;
}

export function validateApiKey(request: Request): string {
  const key = request.headers.get("x-google-api-key");
  if (!key || key.length < 10) {
    throw new ApiError(400, "API_KEY_REQUIRED", "A valid Google AI API key is required. Pass it via the x-google-api-key header.");
  }
  return key;
}

export function validateTarget(input: unknown): PromptTarget {
  if (typeof input !== "string" || !VALID_TARGETS.includes(input as PromptTarget)) {
    return "cursor"; // default
  }
  return input as PromptTarget;
}

export function validateRole(input: unknown): string {
  const valid = ["admin", "member", "viewer"];
  if (typeof input !== "string" || !valid.includes(input)) {
    throw validationError("Invalid role. Must be admin, member, or viewer.");
  }
  return input;
}

export function validateGitHubUsername(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw validationError("github_username is required");
  }
  const trimmed = input.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed) || trimmed.length > 39) {
    throw validationError("Invalid GitHub username format");
  }
  return trimmed;
}
