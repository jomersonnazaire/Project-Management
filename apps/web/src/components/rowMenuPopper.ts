import type { DropdownMenuProps } from 'react-bootstrap';

/**
 * Popper settings for menus opened from a table row (DEF-053).
 *
 * Row tables sit in `.table-responsive` (overflow: auto) so they scroll sideways on phones.
 * A menu rendered inside that box gets clipped and adds a vertical scrollbar. The menu is
 * portalled to <body> and positioned `fixed` against the viewport, so no scroll container
 * can clip it, and it flips above the toggle when there is no room below (last row,
 * single-row tables).
 */
export const ROW_MENU_POPPER_CONFIG: NonNullable<DropdownMenuProps['popperConfig']> = {
  strategy: 'fixed',
  modifiers: [
    {
      name: 'flip',
      options: {
        rootBoundary: 'viewport',
        padding: 8,
        fallbackPlacements: ['top-end', 'top-start'],
      },
    },
    { name: 'preventOverflow', options: { rootBoundary: 'viewport', padding: 8 } },
  ],
};
