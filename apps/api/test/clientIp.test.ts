import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import {
  normaliseIp,
  rateLimitKey,
  resolveClientIp,
  type ClientIpOptions,
} from '../src/middleware/clientIp.js';
import { originMatcher } from '../src/middleware/security.js';

const SECRET = 'test-edge-secret-0123456789abcdef0123456789';
const AZURE: ClientIpOptions = { trustedHops: 1, edgeSecret: SECRET };
// The App Service container always sees the Azure front end's internal address as the peer.
const req = (headers: Record<string, string>, remote = '::ffff:169.254.130.1') =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as Request;

// Header shapes captured on xc8-projectmgmt-api-tc3w on 2026-10-09 (DEF-002 investigation).
const directAzure = (clientXff: string | null, peer = '104.28.194.108:45112') => ({
  'x-forwarded-for': clientXff ? `${clientXff}, ${peer}` : peer,
  'client-ip': peer,
  'x-client-ip': peer.replace(/:\d+$/, ''),
});
const viaVercel = (visitor: string, edge: Record<string, string> = {}) => ({
  // Vercel overwrites XFF with the visitor IP; Azure appends Vercel's egress ip:port.
  'x-forwarded-for': `${visitor}, 13.212.8.174:13482`,
  'x-real-ip': visitor,
  'x-vercel-forwarded-for': visitor,
  'client-ip': '13.212.8.174:13482',
  'x-client-ip': '13.212.8.174',
  ...edge,
});

describe('resolveClientIp: direct to Azure', () => {
  it('uses the entry the Azure front end appended (ip:port), ignoring spoofed leading entries', () => {
    expect(resolveClientIp(req(directAzure(null)), AZURE)).toEqual({
      ip: '104.28.194.108',
      source: 'proxy',
    });
    expect(resolveClientIp(req(directAzure('9.9.9.9')), AZURE).ip).toBe('104.28.194.108');
    expect(resolveClientIp(req(directAzure('9.9.9.9, 8.8.8.8')), AZURE).ip).toBe('104.28.194.108');
  });

  it('ignores a forged edge header without the right secret', () => {
    const forged = { ...directAzure(null), 'x-xc8-client-ip': '1.2.3.4' };
    expect(resolveClientIp(req(forged), AZURE).ip).toBe('104.28.194.108');
    const wrong = { ...forged, 'x-xc8-edge-secret': 'nope' };
    expect(resolveClientIp(req(wrong), AZURE).ip).toBe('104.28.194.108');
    const longWrong = { ...forged, 'x-xc8-edge-secret': SECRET.replace(/.$/, 'X') };
    expect(resolveClientIp(req(longWrong), AZURE).ip).toBe('104.28.194.108');
  });

  it('handles IPv6 peers in brackets with a port', () => {
    expect(resolveClientIp(req(directAzure('9.9.9.9', '[2001:db8::1]:443')), AZURE).ip).toBe(
      '2001:db8::1',
    );
    expect(resolveClientIp(req(directAzure(null, '[::1]:55000')), AZURE).ip).toBe('::1');
  });

  it('falls back to the socket when XFF is missing or junk', () => {
    expect(resolveClientIp(req({}), AZURE)).toEqual({ ip: '169.254.130.1', source: 'socket' });
    expect(resolveClientIp(req({ 'x-forwarded-for': 'garbage' }), AZURE).source).toBe('socket');
  });

  it('trusts nothing in headers when no proxy is configured (local dev)', () => {
    expect(resolveClientIp(req(directAzure('9.9.9.9')), { trustedHops: 0 }).ip).toBe(
      '169.254.130.1',
    );
  });
});

describe('resolveClientIp: through the Vercel /api proxy', () => {
  it('trusts x-xc8-client-ip only with the shared secret', () => {
    const edge = { 'x-xc8-client-ip': '104.28.226.106', 'x-xc8-edge-secret': SECRET };
    expect(resolveClientIp(req(viaVercel('104.28.226.106', edge)), AZURE)).toEqual({
      ip: '104.28.226.106',
      source: 'edge',
    });
  });

  it('gives a spoofed XFF no effect: Vercel overwrites it and the edge header wins', () => {
    // The client sent "X-Forwarded-For: 9.9.9.9"; Vercel replaced it with the real visitor.
    const edge = { 'x-xc8-client-ip': '104.28.194.107', 'x-xc8-edge-secret': SECRET };
    const a = resolveClientIp(req(viaVercel('104.28.194.107', edge)), AZURE);
    const b = resolveClientIp(
      req({
        ...viaVercel('104.28.194.107', edge),
        'x-forwarded-for': '9.9.9.9, 13.208.34.255:27009',
      }),
      AZURE,
    );
    expect(a.ip).toBe('104.28.194.107');
    expect(b.ip).toBe('104.28.194.107');
  });

  it('without the middleware secret, falls back to the Azure-appended (Vercel) address, never the leftmost', () => {
    expect(resolveClientIp(req(viaVercel('104.28.226.106')), AZURE)).toEqual({
      ip: '13.212.8.174',
      source: 'proxy',
    });
    expect(resolveClientIp(req(viaVercel('104.28.226.106')), { trustedHops: 1 }).ip).toBe(
      '13.212.8.174',
    );
  });
});

describe('normaliseIp', () => {
  it('strips ports, brackets, zone ids and IPv4-mapped prefixes', () => {
    expect(normaliseIp('203.0.113.5:4567')).toBe('203.0.113.5');
    expect(normaliseIp('[2001:DB8::1]:443')).toBe('2001:db8::1');
    expect(normaliseIp('::ffff:10.1.2.3')).toBe('10.1.2.3');
    expect(normaliseIp('fe80::1%eth0')).toBe('fe80::1');
    expect(normaliseIp('not-an-ip')).toBeNull();
    expect(normaliseIp('')).toBeNull();
  });
});

describe('rateLimitKey', () => {
  it('groups an IPv4 egress pool by /24 so a rotating client keeps one key', () => {
    const keys = ['104.28.194.103', '104.28.194.105', '104.28.194.109'].map((ip) =>
      rateLimitKey(ip),
    );
    expect(new Set(keys)).toEqual(new Set(['104.28.194.0/24']));
    expect(rateLimitKey('104.28.226.106')).toBe('104.28.226.0/24');
    expect(rateLimitKey('203.0.113.5', 32)).toBe('203.0.113.5');
    expect(rateLimitKey('203.0.113.5', 16)).toBe('203.0.0.0/16');
  });
  it('groups IPv6 by /56', () => {
    expect(rateLimitKey('2a09:bac5:4fa4:4aa::77:ca')).toBe(rateLimitKey('2a09:bac5:4fa4:4ff::1'));
    expect(rateLimitKey('2a09:bac5:4fa4:4aa::77:ca')).not.toBe(
      rateLimitKey('2a09:bac5:4fa4:26be::1'),
    );
  });
});

describe('originMatcher', () => {
  it('matches exact origins and single-label wildcards only', () => {
    const m = originMatcher('https://app.example.com, https://xc8-pm-*.vercel.app');
    expect(m('https://app.example.com')).toBe(true);
    expect(m('https://xc8-pm-abc123-team.vercel.app')).toBe(true);
    expect(m('https://xc8-pm-x.evil.com.vercel.app')).toBe(false);
    expect(m('https://evil.vercel.app')).toBe(false);
    expect(m('http://app.example.com')).toBe(false);
  });
});
