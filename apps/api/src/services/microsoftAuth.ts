import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import type { AppConfig } from '../config.js';

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];
const MAIL_SCOPES = ['Mail.Send'];

export interface MicrosoftIdClaims {
  oid: string;
  tid: string;
  email: string;
  name: string;
  xms_edov?: boolean;
  acct?: number;
  idp?: string;
  nonce?: string;
}

export interface MicrosoftMailToken {
  oid: string;
  tid: string;
  acct?: number;
  idp?: string;
  accessToken: string;
  scopes: string[];
}

const crypto = new CryptoProvider();

/** ID token `email` claim only (never preferred_username). Exported for unit tests. */
export function readEmailFromIdTokenClaims(claims: Record<string, unknown>): string {
  const email = claims.email;
  if (typeof email === 'string' && email.includes('@')) return email.trim().toLowerCase();
  return '';
}

function nameFromClaims(claims: Record<string, unknown>, email: string): string {
  const name = claims.name;
  if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 120);
  return email.split('@')[0] ?? 'User';
}

export function createMsalClient(config: AppConfig): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.MS_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${config.MS_TENANT_ID}`,
      clientSecret: config.MS_CLIENT_SECRET,
    },
  });
}

export type MicrosoftLoginUrlOpts = {
  scopes?: string[];
  loginHint?: string;
  prompt?: 'select_account' | 'none';
};

export async function buildMicrosoftLoginUrl(
  config: AppConfig,
  opts: MicrosoftLoginUrlOpts = {},
): Promise<{
  url: string;
  codeVerifier: string;
  state: string;
  nonce: string;
}> {
  const scopes = opts.scopes ?? DEFAULT_SCOPES;
  const { verifier, challenge } = await crypto.generatePkceCodes();
  const state = crypto.createNewGuid();
  const nonce = crypto.createNewGuid();
  const client = createMsalClient(config);
  const url = await client.getAuthCodeUrl({
    scopes,
    redirectUri: config.MS_REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    state,
    nonce,
    ...(opts.loginHint ? { loginHint: opts.loginHint } : {}),
    ...(opts.prompt !== undefined
      ? { prompt: opts.prompt }
      : scopes.join(' ') === DEFAULT_SCOPES.join(' ')
        ? { prompt: 'select_account' as const }
        : {}),
  });
  return { url, codeVerifier: verifier, state, nonce };
}

/** Our own nonce check, kept alongside MSAL's (defence in depth). */
function parseIdTokenBase(
  claims: Record<string, unknown>,
  expectedNonce: string,
): { oid: string; tid: string; acct?: number; idp?: string } {
  const nonce = claims.nonce;
  if (typeof nonce !== 'string' || nonce !== expectedNonce) {
    throw new Error('Invalid nonce');
  }
  const tid = claims.tid;
  const oid = claims.oid;
  if (typeof tid !== 'string' || typeof oid !== 'string') {
    throw new Error('Missing oid or tid');
  }
  return {
    oid,
    tid,
    acct: typeof claims.acct === 'number' ? claims.acct : undefined,
    idp: typeof claims.idp === 'string' ? claims.idp : undefined,
  };
}

export async function exchangeMicrosoftCode(
  config: AppConfig,
  code: string,
  codeVerifier: string,
  expectedNonce: string,
): Promise<MicrosoftIdClaims> {
  const client = createMsalClient(config);
  const result = await client.acquireTokenByCode({
    code,
    codeVerifier,
    redirectUri: config.MS_REDIRECT_URI,
    scopes: DEFAULT_SCOPES,
    // msal-node 6 checks the ID token's nonce itself and refuses a token that carries one when
    // the request names none (nonce_mismatch). Pass the nonce we put in the auth URL.
    nonce: expectedNonce,
  });
  const claims = (result?.idTokenClaims ?? {}) as Record<string, unknown>;
  const base = parseIdTokenBase(claims, expectedNonce);
  const email = readEmailFromIdTokenClaims(claims);
  if (!email) throw new Error('Missing email');
  return {
    ...base,
    email,
    name: nameFromClaims(claims, email),
    xms_edov: claims.xms_edov === true,
    nonce: typeof claims.nonce === 'string' ? claims.nonce : undefined,
  };
}

export async function exchangeMicrosoftMailCode(
  config: AppConfig,
  code: string,
  codeVerifier: string,
  expectedNonce: string,
): Promise<MicrosoftMailToken> {
  const client = createMsalClient(config);
  const result = await client.acquireTokenByCode({
    code,
    codeVerifier,
    redirectUri: config.MS_REDIRECT_URI,
    scopes: MAIL_SCOPES,
    nonce: expectedNonce,
  });
  const claims = (result?.idTokenClaims ?? {}) as Record<string, unknown>;
  const base = parseIdTokenBase(claims, expectedNonce);
  const accessToken = result?.accessToken;
  if (!accessToken) throw new Error('No access token');
  return {
    ...base,
    accessToken,
    scopes: result?.scopes ?? [],
  };
}

/** Maps Microsoft OAuth error query params to DAR send redirect reasons. */
export function consentReason(error: string, errorDescription?: string): string {
  const desc = errorDescription ?? '';
  if (desc.includes('AADSTS90094') || desc.includes('AADSTS65001')) {
    return 'admin_consent_required';
  }
  if (error === 'access_denied' || error === 'consent_required' || desc.includes('AADSTS65004')) {
    return 'consent_declined';
  }
  return 'send_failed';
}

export function msalMailFailureReason(err: unknown): string | null {
  const text = [
    err instanceof Error ? err.message : String(err),
    typeof err === 'object' && err && 'errorCode' in err
      ? String((err as { errorCode?: string }).errorCode)
      : '',
    typeof err === 'object' && err && 'errorMessage' in err
      ? String((err as { errorMessage?: string }).errorMessage)
      : '',
  ].join(' ');
  if (text.includes('AADSTS90094') || text.includes('AADSTS65001')) {
    return 'admin_consent_required';
  }
  if (
    text.includes('consent_required') ||
    text.includes('AADSTS65004') ||
    text.includes('access_denied')
  ) {
    return 'consent_declined';
  }
  return null;
}

export function hasMailSendScope(scopes: string[]): boolean {
  return scopes.some((s) => s.toLowerCase() === 'mail.send');
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

export function isAllowedMicrosoftMember(claims: MicrosoftIdClaims, _config: AppConfig): boolean {
  if (claims.acct !== 0) return false;
  const expectedIdp = `https://sts.windows.net/${claims.tid}/`;
  if (claims.idp !== undefined && claims.idp !== expectedIdp) return false;
  return true;
}

export function isAllowedMicrosoftMemberFromToken(
  token: Pick<MicrosoftMailToken, 'acct' | 'tid' | 'idp'>,
): boolean {
  if (token.acct !== 0) return false;
  const expectedIdp = `https://sts.windows.net/${token.tid}/`;
  if (token.idp !== undefined && token.idp !== expectedIdp) return false;
  return true;
}

export function isAllowedTenant(tid: string, config: AppConfig): boolean {
  return config.msAllowedTenantIds.includes(tid.toLowerCase());
}

export function isAllowedEmailDomain(email: string, config: AppConfig): boolean {
  const domain = emailDomain(email);
  return domain.length > 0 && config.msAllowedDomains.includes(domain);
}
