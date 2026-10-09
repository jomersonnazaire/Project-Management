import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

type Handler = (url: string, init?: RequestInit) => { status: number; body?: unknown };

/** Replaces fetch with a simple router of canned API responses. */
export function mockApi(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const { status, body } = handler(url, init);
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderAt(path: string, ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A data router like main.tsx, so useBlocker works in tests.
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [path] });
  return {
    router,
    ...render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}
