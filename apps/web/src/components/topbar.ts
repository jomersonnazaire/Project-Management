import { createContext } from 'react';

export interface TopbarSlots {
  title: HTMLElement | null;
  actions: HTMLElement | null;
}

/** Slots in the AppShell top bar that pages render their title and primary action into (DR-02). */
export const TopbarContext = createContext<TopbarSlots>({ title: null, actions: null });
