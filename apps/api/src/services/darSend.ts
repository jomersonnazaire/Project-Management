import { DAR_TOO_LARGE, darEmailRange, darFooter, type DarReportDto } from '@xc8/shared';
import type { Types } from 'mongoose';
import type { AppConfig } from '../config.js';
import { UserModel } from '../models/index.js';
import type { User } from '../models/User.js';
import { darFileName, darToPdf } from './darExport.js';
import {
  darMailHtml,
  GraphSendError,
  graphSendFailureReason,
  MAX_ATTACHMENT_BYTES,
  sendMailWithPdf,
} from './graphMail.js';

export type DarSendDisableReason = 'ms_disabled' | 'not_linked' | 'no_supervisor';

export async function resolveDarSupervisor(user: User) {
  if (!user.supervisorId) return null;
  const sup = await UserModel.findById(user.supervisorId).select('name email active').lean();
  if (!sup?.active || !sup.email?.trim()) return null;
  return { _id: sup._id, name: sup.name, email: sup.email.trim().toLowerCase() };
}

export function buildDarCc(user: User, toEmail: string, senderEmail: string): string[] {
  const to = toEmail.toLowerCase();
  const sender = senderEmail.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of user.reportCc ?? []) {
    const e = raw.trim().toLowerCase();
    if (!e || e === to || e === sender || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= 5) break;
  }
  return out;
}

export async function darSendStatusPayload(config: AppConfig, user: User) {
  const supervisor = await resolveDarSupervisor(user);
  const to = supervisor ? { name: supervisor.name, email: supervisor.email } : null;
  const cc = supervisor ? buildDarCc(user, supervisor.email, user.email) : [];
  const canNotify = !user.msOid && Boolean(supervisor);

  if (!config.msEnabled) {
    return { enabled: false, reason: 'ms_disabled' as const, canNotify, to, cc };
  }
  if (!user.msOid || !user.msTid) {
    return { enabled: false, reason: 'not_linked' as const, canNotify, to, cc };
  }
  if (!supervisor) {
    return { enabled: false, reason: 'no_supervisor' as const, canNotify, to: null, cc: [] };
  }
  return { enabled: true, reason: null, canNotify, to, cc };
}

/** Subject "DAR – {name} – {range}"; the body shows "Generated range:" once. */
export function darMailContent(
  userName: string,
  report: DarReportDto,
): { subject: string; html: string } {
  const range = darEmailRange(report.from, report.shownTo ?? report.to);
  return {
    subject: `DAR – ${userName} – ${range}`,
    html: darMailHtml({
      range,
      totalActivities: report.totalActivities,
      totalRendered: report.totalRendered,
      footer: darFooter(report),
    }),
  };
}

export async function sendDarReportEmail(
  accessToken: string,
  user: User,
  saved: { _id: Types.ObjectId; report: DarReportDto },
  to: { email: string; name: string },
  cc: string[],
): Promise<{ bytes: number; fileName: string }> {
  const report = saved.report;
  const pdf = await darToPdf(report);
  if (pdf.length > MAX_ATTACHMENT_BYTES) {
    throw new GraphSendError(413, 'too_large', DAR_TOO_LARGE);
  }
  const { subject, html } = darMailContent(user.name, report);
  const fileName = darFileName(report, 'pdf');
  await sendMailWithPdf(accessToken, {
    subject,
    html,
    to: to.email,
    cc,
    fileName,
    pdf,
  });
  return { bytes: pdf.length, fileName };
}

export { GraphSendError, graphSendFailureReason };
