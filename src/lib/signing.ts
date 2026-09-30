import { createHash, createHmac } from 'node:crypto';

/**
 * Access-key request signing (`Huudis-HMAC-SHA256`) — the same algorithm as the SDKs
 * and the server (backend/src/services/iam-access-keys.ts):
 *
 *   StringToSign = METHOD "\n" PATH-WITH-QUERY "\n" X-Huudis-Date "\n" hex(sha256(body))
 *   Signature    = hex(HMAC-SHA256(secret, StringToSign))
 */
export function signRequest(
  creds: { accessKeyId: string; secretAccessKey: string },
  input: { method: string; url: string; body?: string; date?: Date },
): { Authorization: string; 'X-Huudis-Date': string } {
  const url = new URL(input.url);
  const date = (input.date ?? new Date()).toISOString();
  const bodyHash = createHash('sha256').update(input.body ?? '').digest('hex');
  const stringToSign = `${input.method.toUpperCase()}\n${url.pathname}${url.search}\n${date}\n${bodyHash}`;
  const signature = createHmac('sha256', creds.secretAccessKey).update(stringToSign).digest('hex');
  return {
    Authorization: `Huudis-HMAC-SHA256 Credential=${creds.accessKeyId}, Signature=${signature}`,
    'X-Huudis-Date': date,
  };
}
