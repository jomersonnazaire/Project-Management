import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from 'react-bootstrap';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions use a red confirm button. */
  danger?: boolean;
}

/**
 * The app's confirm dialog (DR-35), used instead of the browser's native confirm(). Call the
 * returned function and await its answer; render the returned element anywhere in the component.
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (await confirm({ title: 'Delete this entry?', confirmLabel: 'Delete', danger: true })) …
 */
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );
  const close = (answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setOpts(null);
  };
  const element = opts ? (
    <Modal show onHide={() => close(false)} centered aria-labelledby="confirm-modal-title">
      <Modal.Header closeButton>
        <Modal.Title as="h2" className="h5" id="confirm-modal-title">
          {opts.title}
        </Modal.Title>
      </Modal.Header>
      {opts.body && <Modal.Body>{opts.body}</Modal.Body>}
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={() => close(false)}>
          {opts.cancelLabel ?? 'Cancel'}
        </Button>
        <Button variant={opts.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
          {opts.confirmLabel ?? 'OK'}
        </Button>
      </Modal.Footer>
    </Modal>
  ) : null;
  return [confirm, element];
}
