const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001").replace(
  /\/+$/,
  "",
);

export function requestApi(path: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`${apiBaseUrl}${path}`, {
    cache: "no-store",
    signal,
  });
}

export async function fetchApiJson<T>(path: string): Promise<T> {
  const response = await requestApi(path);
  if (!response.ok) throw new Error("The shop could not load this information.");
  return (await response.json()) as T;
}
