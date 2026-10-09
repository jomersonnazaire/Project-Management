import { deflateRawSync } from 'node:zlib';
import type { Express } from 'express';
import type request from 'supertest';
import { expect } from 'vitest';
import type { MemoryBlobStore } from '../src/storage/blobStore.js';
import { UploadModel } from '../src/models/index.js';
import { CSRF } from './helpers.js';

type Agent = ReturnType<typeof request.agent>;

/** Minimal ZIP writer (deflated entries) for building .docx / .xlsx / .docm test files. */
export function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content);
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const CT = (main: string) =>
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.main+xml"/></Types>`;

export const FILES = {
  pdf: () => Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
  docx: () =>
    zip({ '[Content_Types].xml': CT('word/document.xml'), 'word/document.xml': '<w:document/>' }),
  xlsx: () =>
    zip({ '[Content_Types].xml': CT('xl/workbook.xml'), 'xl/workbook.xml': '<workbook/>' }),
  docm: () =>
    zip({
      '[Content_Types].xml': CT('word/document.xml').replace(
        'main+xml',
        'document.macroEnabled.main+xml',
      ),
      'word/document.xml': '<w:document/>',
      'word/vbaProject.bin': 'VBA',
    }),
  zipOnly: () => zip({ 'notes.txt': 'hello' }),
  exe: () => Buffer.concat([Buffer.from('MZ\x90\x00'), Buffer.alloc(200, 1)]),
  png: () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  eicar: () => Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
};

export const store = (app: Express) => app.locals.blobStore as MemoryBlobStore;

/** Asks for an evidence upload link; returns the response. */
export async function evidenceTicket(agent: Agent, taskId: string, name: string, size: number) {
  return agent
    .post(`/api/v1/tasks/${taskId}/evidence/uploads`)
    .set(CSRF)
    .send({ files: [{ name, size }] });
}

/** Full evidence upload: ticket, PUT the bytes (through the dev blob route), complete. */
export async function uploadEvidence(agent: Agent, taskId: string, name: string, data: Buffer) {
  const t = await evidenceTicket(agent, taskId, name, data.length);
  if (t.status !== 201) return t;
  const up = t.body.uploads[0];
  const put = await agent
    .put(up.uploadUrl)
    .set(CSRF)
    .set('Content-Type', 'application/octet-stream')
    .send(data);
  expect(put.status).toBe(201);
  return agent.post(`/api/v1/uploads/${up.id}/complete`).set(CSRF).send({});
}

/** Puts bytes straight into the memory store (for big files), then completes. */
export async function completeWith(app: Express, agent: Agent, uploadId: string, data: Buffer) {
  const up = await UploadModel.findById(uploadId).lean();
  store(app).put(up!.blobKey, data);
  return agent.post(`/api/v1/uploads/${uploadId}/complete`).set(CSRF).send({});
}
