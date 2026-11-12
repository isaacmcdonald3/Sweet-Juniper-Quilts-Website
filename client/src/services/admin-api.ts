import { supabaseClient } from "./supabase";
import { getApiUrl, requestApi } from "./storefront-api";

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

export async function uploadAdminFile<T>(
  path: string,
  file: File,
  fields: Record<string, string>,
  onProgress: (progress: number) => void,
): Promise<T> {
  if (!supabaseClient) throw new AdminApiError("Owner sign-in is not configured.", 503);
  const { data, error } = await supabaseClient.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new AdminApiError("Please sign in to continue.", 401);

  const formData = new FormData();
  formData.append("file", file);
  Object.entries(fields).forEach(([key, value]) => formData.append(key, value));

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", getApiUrl(path));
    xhr.responseType = "json";
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        const payload = xhr.response as { error?: string } | null;
        reject(
          new AdminApiError(
            payload?.error || "The media upload could not be completed.",
            xhr.status,
          ),
        );
        return;
      }
      resolve(xhr.response as T);
    });
    xhr.addEventListener("error", () => {
      reject(new AdminApiError("The media upload could not reach the server.", 0));
    });
    xhr.send(formData);
  });
}
