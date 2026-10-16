import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailable } from '../src/middleware/errors.js';

function named(name: string, message = 'boom', extra: Record<string, unknown> = {}) {
  const e = new Error(message);
  e.name = name;
  return Object.assign(e, extra);
}

describe('isDatabaseUnavailable', () => {
  it.each([
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongoServerSelectionError',
    'PoolClearedError',
    'PoolClearedOnNetworkError',
    'MongoTopologyClosedError',
    'MongoNotConnectedError',
  ])('%s → unavailable', (name) => {
    expect(isDatabaseUnavailable(named(name))).toBe(true);
  });

  it('mongoose buffering timeout → unavailable', () => {
    expect(
      isDatabaseUnavailable(
        named('MongooseError', 'Operation `x.find()` buffering timed out after 10000ms'),
      ),
    ).toBe(true);
  });

  it('error labels ResetPool / NetworkError → unavailable (Set or array)', () => {
    expect(
      isDatabaseUnavailable(
        named('MongoServerError', 'x', { errorLabels: new Set(['ResetPool']) }),
      ),
    ).toBe(true);
    expect(
      isDatabaseUnavailable(named('MongoServerError', 'x', { errorLabels: ['NetworkError'] })),
    ).toBe(true);
    const viaMethod = named('MongoServerError', 'x', {
      hasErrorLabel: (l: string) => l === 'ResetPool',
    });
    expect(isDatabaseUnavailable(viaMethod)).toBe(true);
  });

  it('a MongoServerError that merely mentions "connection" is NOT unavailable', () => {
    expect(
      isDatabaseUnavailable(named('MongoServerError', 'invalid field "connection" in $set')),
    ).toBe(false);
    expect(
      isDatabaseUnavailable(
        named('MongoServerError', 'x', { errorLabels: ['TransientTransactionError'] }),
      ),
    ).toBe(false);
    expect(isDatabaseUnavailable(new Error('connection refused'))).toBe(false);
    expect(isDatabaseUnavailable('MongoNetworkError')).toBe(false);
  });
});
