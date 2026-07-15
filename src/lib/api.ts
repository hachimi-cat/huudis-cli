/**
 * Thin Huudis API client for the CLI. Only the endpoints a signed-in
 * CLI needs — discovery, device flow, userinfo, logout.
 */

export interface DiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  device_authorization_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
}

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  id_token: string;
  scope: string;
}

export class HuudisApiError extends Error {
  constructor(public readonly error: string, public readonly description?: string) {
    super(description ? `${error}: ${description}` : error);
    this.name = 'HuudisApiError';
  }
}

async function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok || (data?.error && !data?.access_token)) {
    throw new HuudisApiError(data?.error ?? `HTTP ${res.status}`, data?.error_description);
  }
  return data as T;
}

export async function fetchDiscovery(issuer: string): Promise<DiscoveryDoc> {
  const res = await fetch(`${issuer}/api/v1/oidc/.well-known/openid-configuration`);
  if (!res.ok) throw new HuudisApiError('discovery_failed', `HTTP ${res.status}`);
  return res.json() as Promise<DiscoveryDoc>;
}

export async function startDeviceFlow(params: {
  issuer: string;
  clientId: string;
  scope: string;
}): Promise<DeviceAuthorizationResponse> {
  const disco = await fetchDiscovery(params.issuer);
  return post<DeviceAuthorizationResponse>(disco.device_authorization_endpoint, {
    client_id: params.clientId,
    scope: params.scope,
  });
}

export async function pollDeviceToken(params: {
  issuer: string;
  clientId: string;
  deviceCode: string;
}): Promise<{ ready: true; tokens: TokenResponse } | { ready: false; error: string }> {
  const disco = await fetchDiscovery(params.issuer);
  try {
    const tokens = await post<TokenResponse>(disco.token_endpoint, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: params.deviceCode,
      client_id: params.clientId,
    });
    return { ready: true, tokens };
  } catch (e) {
    if (e instanceof HuudisApiError) return { ready: false, error: e.error };
    throw e;
  }
}

export async function refreshAccessToken(params: {
  issuer: string;
  clientId: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  const disco = await fetchDiscovery(params.issuer);
  return post<TokenResponse>(disco.token_endpoint, {
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
}

export async function fetchUserinfo(params: { issuer: string; accessToken: string }): Promise<Record<string, unknown>> {
  const disco = await fetchDiscovery(params.issuer);
  const res = await fetch(disco.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new HuudisApiError(`userinfo_failed`, text);
  }
  return res.json() as Promise<Record<string, unknown>>;
}
