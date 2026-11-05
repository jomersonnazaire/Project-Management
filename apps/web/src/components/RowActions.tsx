import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown } from 'react-bootstrap';
import type { DropdownMenuProps } from 'react-bootstrap';
import { ROW_MENU_POPPER_CONFIG } from './rowMenuPopper';

/**
 * A Dropdown.Menu for a table row: rendered in <body> so `.table-responsive` never clips it.
 * Use inside a react-bootstrap <Dropdown> (context still flows through the portal).
 */
export function RowActionsMenu({
  children,
  ...props
}: DropdownMenuProps & { children: ReactNode }) {
  const menu = (
    <Dropdown.Menu {...props} popperConfig={ROW_MENU_POPPER_CONFIG}>
      {children}
    </Dropdown.Menu>
  );
  return typeof document === 'undefined' ? menu : createPortal(menu, document.body);
}

/** The standard ⋮ row action menu (Edit / Deactivate …). Children are Dropdown.Item elements. */
export function RowActions({
  label,
  className,
  toggleClassName = 'hide-arrow p-0 text-body',
  children,
}: {
  /** Accessible name for the ⋮ toggle, e.g. "Actions for R. Santos". */
  label: string;
  className?: string;
  toggleClassName?: string;
  children: ReactNode;
}) {
  return (
    <Dropdown align="end" className={className}>
      <Dropdown.Toggle variant="link" size="sm" className={toggleClassName} aria-label={label}>
        <i className="bx bx-dots-vertical-rounded fs-5" aria-hidden="true" />
      </Dropdown.Toggle>
      <RowActionsMenu>{children}</RowActionsMenu>
    </Dropdown>
  );
}
