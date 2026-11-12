import { useCallback, useEffect, useState } from "react";
import { requestAdminJson } from "../services/admin-api";

export function useAdminResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    requestAdminJson<T>(path)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "The request could not be completed.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  return { data, loading, error, reload };
}
