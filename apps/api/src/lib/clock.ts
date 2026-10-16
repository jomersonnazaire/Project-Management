/**
 * Injectable clock for testing. In production, returns the real current time.
 * In tests, can be overridden to return a fixed time without affecting the
 * MongoDB driver's internal heartbeat and connection monitoring.
 */

let testNow: Date | null = null;

export function now(): Date {
  return testNow ? new Date(testNow) : new Date();
}

export function setTestTime(time: Date | string | number | null): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setTestTime can only be called in test environment');
  }
  if (time === null) {
    testNow = null;
  } else if (typeof time === 'number') {
    testNow = new Date(time);
  } else if (typeof time === 'string') {
    testNow = new Date(time);
  } else {
    testNow = time;
  }
}

export function resetTestTime(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetTestTime can only be called in test environment');
  }
  testNow = null;
}
