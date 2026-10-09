import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { fileExtension, type FileKind } from '@xc8/shared';

/**
 * Server-side content checks (FR-EVD-02, FR-DOC-13, Q-29). The real type comes from the file's
 * bytes, never its name or the browser's type. Office files are also opened far enough to refuse
 * macros (.docm / .xlsm saved under another name, or legacy files with a VBA project).
 */
export type DetectResult =
  { ok: true; kind: FileKind; mimeType: string } | { ok: false; reason: 'MISMATCH' | 'MACRO' };

const startsWith = (buf: Buffer, sig: number[]) => sig.every((b, i) => buf[i] === b);

/** Entry names from a ZIP's central directory (no decompression). */
export function zipEntries(buf: Buffer): string[] | null {
  // End of central directory record: last 22..65,557 bytes.
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count && n < 10_000; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Reads one stored or deflated ZIP entry (used for [Content_Types].xml), up to 1 MB. */
export function zipEntry(buf: Buffer, wanted: string): Buffer | null {
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    const start = p + 30 + nameLen + extraLen;
    if (name === wanted) {
      const data = buf.subarray(start, start + size);
      try {
        if (method === 0) return data;
        if (method === 8) return inflateRawSync(data, { maxOutputLength: 1_048_576 });
      } catch {
        return null;
      }
      return null;
    }
    if (!size) return null; // data descriptor: sizes unknown here, stop scanning
    p = start + size;
  }
  return null;
}

const utf16 = (s: string) => Buffer.from(s, 'utf16le');

export function detectFileType(buf: Buffer, name: string): DetectResult {
  const ext = fileExtension(name);
  if (ext === 'pdf') {
    // %PDF- within the first 1 KB (some writers prepend a few bytes).
    const head = buf.subarray(0, 1024).indexOf('%PDF-');
    return head >= 0
      ? { ok: true, kind: 'PDF', mimeType: 'application/pdf' }
      : { ok: false, reason: 'MISMATCH' };
  }
  if (ext === 'png') {
    return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ? { ok: true, kind: 'IMAGE', mimeType: 'image/png' }
      : { ok: false, reason: 'MISMATCH' };
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    return startsWith(buf, [0xff, 0xd8, 0xff])
      ? { ok: true, kind: 'IMAGE', mimeType: 'image/jpeg' }
      : { ok: false, reason: 'MISMATCH' };
  }
  if (ext === 'doc' || ext === 'xls') {
    // Legacy Office: OLE2 compound file with a WordDocument / Workbook stream (A-14).
    if (!startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
      return { ok: false, reason: 'MISMATCH' };
    }
    const word = buf.includes(utf16('WordDocument'));
    const excel = buf.includes(utf16('Workbook')) || buf.includes(utf16('Book'));
    if ((ext === 'doc' && !word) || (ext === 'xls' && !excel)) {
      return { ok: false, reason: 'MISMATCH' };
    }
    if (buf.includes(utf16('_VBA_PROJECT')) || buf.includes(utf16('Macros'))) {
      return { ok: false, reason: 'MACRO' };
    }
    return ext === 'doc'
      ? { ok: true, kind: 'WORD', mimeType: 'application/msword' }
      : { ok: true, kind: 'EXCEL', mimeType: 'application/vnd.ms-excel' };
  }
  if (ext === 'docx' || ext === 'xlsx') {
    if (!startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return { ok: false, reason: 'MISMATCH' };
    const entries = zipEntries(buf);
    if (!entries || !entries.includes('[Content_Types].xml')) {
      return { ok: false, reason: 'MISMATCH' };
    }
    const main = ext === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
    if (!entries.includes(main)) return { ok: false, reason: 'MISMATCH' };
    if (entries.some((e) => /vbaProject\.bin$/i.test(e))) return { ok: false, reason: 'MACRO' };
    const types = zipEntry(buf, '[Content_Types].xml')?.toString('utf8') ?? '';
    if (/macroEnabled/i.test(types)) return { ok: false, reason: 'MACRO' };
    return ext === 'docx'
      ? {
          ok: true,
          kind: 'WORD',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }
      : {
          ok: true,
          kind: 'EXCEL',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
  }
  return { ok: false, reason: 'MISMATCH' };
}

/**
 * Built-in malware check (Q-29): the EICAR test signature and Microsoft Defender for Storage's
 * verdict when it has tagged the blob. Defender (enabled on the storage account) does the real
 * scanning; this catches the industry test file even before Defender's tag lands.
 */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
export const DEFENDER_TAG = 'Malware Scanning scan result';

export function malwareVerdict(
  buf: Buffer | null,
  tags: Record<string, string> = {},
): string | null {
  const defender = tags[DEFENDER_TAG];
  if (defender && /malicious/i.test(defender)) return `Defender: ${defender}`;
  if (buf && buf.includes(EICAR)) return 'EICAR test signature';
  return null;
}

export const sha256Hex = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
