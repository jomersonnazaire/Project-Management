import { useId, useRef, useState } from 'react';
import { Button, Form, InputGroup } from 'react-bootstrap';

/** Read-only link with a Copy button (falls back to select + execCommand without Clipboard API). */
export function CopyLinkField({ label, url, id }: { label: string; url: string; id?: string }) {
  const autoId = useId();
  const inputId = id ?? `copy-link-${autoId}`;
  const ref = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      ref.current?.select();
      document.execCommand('copy');
    }
    setCopied(true);
  };
  return (
    <>
      <Form.Label htmlFor={inputId}>{label}</Form.Label>
      <InputGroup>
        <Form.Control
          id={inputId}
          ref={ref}
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
        />
        <Button variant="outline-primary" onClick={() => void copy()}>
          <i className="bx bx-copy me-1" aria-hidden="true" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </InputGroup>
      <span className="visually-hidden" aria-live="polite">
        {copied ? 'Link copied to clipboard' : ''}
      </span>
    </>
  );
}
