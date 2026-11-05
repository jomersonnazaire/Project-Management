import { describe, expect, it } from 'vitest';
import { CLIENT_EXPORT_ROWS_HEADERS, clientExportLimitToast } from '../src/index.js';

// Q-119 / AC-63.7: amber toast after an export with a sheet over the 2,000-row import limit.
describe('clientExportLimitToast', () => {
  it('is null when every sheet fits, including exactly 2,000 rows', () => {
    expect(clientExportLimitToast({ Clients: 0, Contacts: 0 })).toBeNull();
    expect(clientExportLimitToast({ Clients: 2000, Contacts: 2000 })).toBeNull();
  });

  it('names one sheet with its count (thousands separator)', () => {
    expect(clientExportLimitToast({ Clients: 12, Contacts: 2340 })).toBe(
      'Downloaded. The Contacts sheet has 2,340 rows, over the 2,000 limit, so split it into smaller files before importing.',
    );
    expect(clientExportLimitToast({ Clients: 2001, Contacts: 5 })).toBe(
      'Downloaded. The Clients sheet has 2,001 rows, over the 2,000 limit, so split it into smaller files before importing.',
    );
  });

  it('names both sheets in one sentence', () => {
    expect(clientExportLimitToast({ Clients: 2100, Contacts: 2340 })).toBe(
      'Downloaded. The Clients sheet has 2,100 rows and the Contacts sheet has 2,340 rows, over the 2,000 limit, so split them into smaller files before importing.',
    );
    expect(clientExportLimitToast({ Clients: 12345, Contacts: 1000000 })).toContain(
      '12,345 rows and the Contacts sheet has 1,000,000 rows',
    );
  });

  it('header names', () => {
    expect(CLIENT_EXPORT_ROWS_HEADERS).toEqual({
      Clients: 'X-Export-Clients-Rows',
      Contacts: 'X-Export-Contacts-Rows',
    });
  });
});
