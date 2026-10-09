import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { clientIp } from '../src/middleware/clientIp.js';
import { originMatcher } from '../src/middleware/security.js';

const req = (xff: string | undefined, remote = '::ffff:10.1.2.3') =>
  ({
    headers: xff ? { 'x-forwarded-for': xff } : {},
    socket: { remoteAddress: remote },
  }) as unknown as Request;

describe('clientIp', () => {
  it('uses the socket address when no proxy is trusted (spoofed XFF ignored)', () => {
    expect(clientIp(req('1.1.1.1'), 0)).toBe('10.1.2.3');
  });
  it('takes the N-th entry from the right and strips Azure ports', () => {
    expect(clientIp(req('6.6.6.6, 203.0.113.5:4567'), 1)).toBe('203.0.113.5');
    expect(clientIp(req('6.6.6.6, 198.51.100.1, 76.76.21.21:443'), 2)).toBe('198.51.100.1');
    expect(clientIp(req('[2001:db8::1]:443'), 1)).toBe('2001:db8::1');
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
