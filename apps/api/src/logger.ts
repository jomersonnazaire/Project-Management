import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';

/** Structured JSON logs with request ids; credentials are always redacted (NFR-18). */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.newPassword',
        '*.currentPassword',
      ],
      censor: '[redacted]',
    },
  });
}

export function httpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId(req: IncomingMessage, res: ServerResponse) {
      const incoming = req.headers['x-request-id'];
      const id =
        typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming)
          ? incoming
          : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      // Status only: response headers include Set-Cookie with the session token.
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
      // Log the path only: invite tokens and other secrets must never land in logs.
      req(req: { id: string; method: string; url: string }) {
        return {
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0]?.replace(/\/auth\/invite\/[^/]+/, '/auth/invite/[redacted]'),
        };
      },
    },
  });
}
