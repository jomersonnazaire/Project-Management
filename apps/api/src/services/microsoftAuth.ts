import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import type { AppConfig } from '../config.js';

const SCOPES = ['openid', 'profile', 'email'];

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

export async function buildMicrosoftLoginUrl(config: AppConfig): Promise<{
  url: string;
  codeVerifier: string;
  state: string;
  nonce: string;
}> {
  const { verifier, challenge } = await crypto.generatePkceCodes();
  const state = crypto.createNewGuid();
  const nonce = crypto.createNewGuid();
  const client = createMsalClient(config);
  const url = await client.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: config.MS_REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    state,
    nonce,
    prompt: 'select_account',
  });
  return { url, codeVerifier: verifier, state, nonce };
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
    scopes: SCOPES,
  });
  const claims = (result?.idTokenClaims ?? {}) as Record<string, unknown>;
  const nonce = claims.nonce;
  if (typeof nonce !== 'string' || nonce !== expectedNonce) {
    throw new Error('Invalid nonce');
  }
  const tid = claims.tid;
  const oid = claims.oid;
  if (typeof tid !== 'string' || typeof oid !== 'string') {
    throw new Error('Missing oid or tid');
  }
  const email = readEmailFromIdTokenClaims(claims);
  if (!email) throw new Error('Missing email');
  return {
    oid,
    tid,
    email,
    name: nameFromClaims(claims, email),
    xms_edov: claims.xms_edov === true,
    acct: typeof claims.acct === 'number' ? claims.acct : undefined,
    idp: typeof claims.idp === 'string' ? claims.idp : undefined,
    nonce: typeof claims.nonce === 'string' ? claims.nonce : undefined,
  };
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

export function isAllowedTenant(tid: string, config: AppConfig): boolean {
  return config.msAllowedTenantIds.includes(tid.toLowerCase());
}

export function isAllowedEmailDomain(email: string, config: AppConfig): boolean {
  const domain = emailDomain(email);
  return domain.length > 0 && config.msAllowedDomains.includes(domain);
}
