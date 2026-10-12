"use client";

/**
 * How the workspace reaches Hermes. Production is the documented `/api/hermes` contract, unchanged.
 * The fixture (`./fixture-adapter.ts`) exists only for UI development without the service: it is
 * loaded on demand, labels everything it returns, and is used only when fixtures are allowed and
 * the page was opened with `?hermes=fixture`. A normal visit always talks to the live service.
 */

/** Development builds, or a build made with NEXT_PUBLIC_HERMES_FIXTURES=1. */
function fixturesAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_HERMES_FIXTURES === "1";
}

export function wantsFixture() {
  if (typeof window === "undefined" || !fixturesAllowed()) return false;
  return new URLSearchParams(window.location.search).get("hermes") === "fixture";
}

/**
 * One Hermes request: agent status, an investigation poll, or (with a body) a submission. Same
 * shape as the route's JSON; callers validate it with the contract schemas.
 */
export async function requestHermes(search: URLSearchParams, signal?: AbortSignal, body?: unknown) {
  if (wantsFixture()) {
    const { fixtureRequest } = await import("./fixture-adapter");
    return fixtureRequest(search, body);
  }
  const response = await fetch(`/api/hermes?${search}`, {
    cache: "no-store",
    signal,
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? "Hermes is unavailable.");
  return payload;
}
