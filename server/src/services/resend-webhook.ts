import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyResendWebhookSignature(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  rawBody: Buffer,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^whsec_[A-Za-z0-9+/=_-]+$/.test(secret)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds) || Math.abs(now / 1000 - timestampSeconds) > 300) return false;

  const encodedSecret = secret.slice("whsec_".length);
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(encodedSecret, "base64");
  } catch {
    return false;
  }
  if (!secretBytes.length) return false;

  const expected = createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.`)
    .update(rawBody)
    .digest();
  return signature.split(" ").some((candidate) => {
    const [version, value] = candidate.split(",", 2);
    if (version !== "v1" || !value) return false;
    let supplied: Buffer;
    try {
      supplied = Buffer.from(value, "base64");
    } catch {
      return false;
    }
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}
