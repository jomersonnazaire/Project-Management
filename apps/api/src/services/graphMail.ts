import { DAR_MAX_PDF_BYTES, DAR_TOO_LARGE } from '@xc8/shared';

/** 2.5 MB raw: base64 adds ~33%, and Graph's sendMail JSON request is capped at ~4 MB. */
export const MAX_ATTACHMENT_BYTES = DAR_MAX_PDF_BYTES;

export class GraphSendError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function darMailHtml(summary: {
  range: string;
  totalActivities: number;
  totalRendered: string;
  footer: string;
}): string {
  return `<p><strong>Generated range:</strong> ${escapeHtml(summary.range)}</p>
<p><strong>Total Activities:</strong> ${summary.totalActivities}</p>
<p><strong>Total rendered hours:</strong> ${escapeHtml(summary.totalRendered)}</p>
<p>${escapeHtml(summary.footer)}</p>`;
}

export function graphSendFailureReason(status: number, code: string): string {
  const c = code ?? '';
  if (
    c === 'MailboxNotEnabledForRESTAPI' ||
    c === 'MailboxNotSupportedForRESTAPI' ||
    c === 'ResourceNotFound'
  ) {
    return 'no_mailbox';
  }
  if (status === 401) return 'ms_auth_failed';
  if (status === 403) return 'send_forbidden';
  if (status === 404) return 'no_mailbox';
  if (status === 400 && c === 'ErrorInvalidRecipients') return 'bad_recipient';
  if (status === 400) return 'send_failed';
  if (status === 413) return 'too_large';
  if (status === 429 || status >= 500) return 'graph_unavailable';
  return 'send_failed';
}

export async function sendMailWithPdf(
  accessToken: string,
  input: {
    subject: string;
    html: string;
    to: string;
    cc: string[];
    fileName: string;
    pdf: Buffer;
  },
): Promise<void> {
  if (input.pdf.length > MAX_ATTACHMENT_BYTES) {
    throw new GraphSendError(413, 'too_large', DAR_TOO_LARGE);
  }
  const body = {
    message: {
      subject: input.subject,
      body: { contentType: 'HTML', content: input.html },
      toRecipients: [{ emailAddress: { address: input.to } }],
      ccRecipients: input.cc.map((address) => ({ emailAddress: { address } })),
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: input.fileName,
          contentType: 'application/pdf',
          contentBytes: input.pdf.toString('base64'),
        },
      ],
    },
    saveToSentItems: true,
  };
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify(body),
  });
  if (res.status === 202) return;
  let code = 'send_failed';
  try {
    const json = (await res.json()) as { error?: { code?: string } };
    if (typeof json.error?.code === 'string') code = json.error.code;
  } catch {
    /* ignore */
  }
  throw new GraphSendError(res.status, code);
}

/**
 * A plain HTML email (no attachment) from the signed-in user's own mailbox via delegated
 * /me/sendMail: it lands in their Sent Items. Used by follow-up emails; DAR Send keeps
 * sendMailWithPdf. Throws GraphSendError like sendMailWithPdf.
 */
export async function sendMailAsUser(
  accessToken: string,
  input: { subject: string; html: string; to: string[] },
): Promise<void> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: 'HTML', content: input.html },
        toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  if (res.status === 202) return;
  let code = 'send_failed';
  try {
    const json = (await res.json()) as { error?: { code?: string } };
    if (typeof json.error?.code === 'string') code = json.error.code;
  } catch {
    /* ignore */
  }
  throw new GraphSendError(res.status, code);
}
