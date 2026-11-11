export function getContentSection(content: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = content[key];
  if (typeof value === "string") return { body: value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function getContentText(
  section: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = section[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}
