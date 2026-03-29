const LOCALHOST_ORIGIN = "http://localhost:3000";

interface HeaderLookup {
  get(name: string): string | null;
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

function normalizeProtocol(value: string | null): "http" | "https" | null {
  const candidate = value?.split(",")[0]?.trim().toLowerCase();

  if (candidate === "http" || candidate === "https") {
    return candidate;
  }

  return null;
}

function buildOrigin(host: string | null, protocol: string | null): string | null {
  const normalizedHost = host?.split(",")[0]?.trim();

  if (!normalizedHost) {
    return null;
  }

  const normalizedProtocol =
    normalizeProtocol(protocol) ??
    (normalizedHost.startsWith("localhost") || normalizedHost.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return normalizeOrigin(`${normalizedProtocol}://${normalizedHost}`);
}

export function resolveAuthOrigin(headersLike: HeaderLookup, requestUrl?: string): string {
  return (
    buildOrigin(headersLike.get("x-forwarded-host"), headersLike.get("x-forwarded-proto")) ??
    normalizeOrigin(headersLike.get("origin")) ??
    normalizeOrigin(requestUrl) ??
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
    buildOrigin(headersLike.get("host"), headersLike.get("x-forwarded-proto")) ??
    LOCALHOST_ORIGIN
  );
}
