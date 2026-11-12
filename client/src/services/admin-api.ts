import { supabaseClient } from "./supabase";
import { requestApi } from "./storefront-api";

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function requestAdminJson<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!supabaseClient) throw new AdminApiError("Owner sign-in is not configured.", 503);
  const { data, error } = await supabaseClient.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new AdminApiError("Please sign in to continue.", 401);

  const response = await requestApi(path, undefined, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new AdminApiError(
      payload?.error || "The request could not be completed.",
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
