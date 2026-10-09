import { pageTitle } from '@xc8/shared';
import { useEffect } from 'react';

/** Browser tab: "Page · App name" (name from packages/shared/src/brand.ts). */
export function useDocumentTitle(page?: string) {
  useEffect(() => {
    document.title = pageTitle(page);
  }, [page]);
}
