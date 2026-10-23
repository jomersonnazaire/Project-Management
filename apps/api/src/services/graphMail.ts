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

/**
 * The request may have reached Graph but no answer came back (our 20 s timeout fired, or the
 * connection dropped mid-request). The mail may or may not have been sent, so callers must not
 * report this as a failure, and must not retry on their own.
 */
export class GraphSendUnknownError extends Error {
  constructor(cause: unknown) {
    super('Graph send result unknown', { cause });
    this.name = 'GraphSendUnknownError';
  }
}

/** Connection errors raised before any byte of the request left (nothing can have been sent). */
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function errCode(err: unknown): string {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

/**
 * POST /me/sendMail. A rejected fetch is either a connect failure (definitely not sent:
 * GraphSendError 503 → graph_unavailable) or anything after that, including our timeout
 * (GraphSendUnknownError: it may have been sent).
 */
async function postSendMail(accessToken: string, body: unknown): Promise<void> {
  let res: globalThis.Response;
  try {
    res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (NOT_SENT_CODES.has(errCode(err))) {
      throw new GraphSendError(503, 'network_unreachable');
    }
    throw new GraphSendUnknownError(err);
  }
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
  await postSendMail(accessToken, body);
}

/**
 * A plain HTML email (no attachment) from the signed-in user's own mailbox via delegated
 * /me/sendMail: it lands in their Sent Items. Used by follow-up emails; DAR Send keeps
 * sendMailWithPdf. Throws GraphSendError or GraphSendUnknownError like sendMailWithPdf.
 */
export async function sendMailAsUser(
  accessToken: string,
  input: { subject: string; html: string; to: string[] },
): Promise<void> {
  await postSendMail(accessToken, {
    message: {
      subject: input.subject,
      body: { contentType: 'HTML', content: input.html },
      toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: true,
  });
}
