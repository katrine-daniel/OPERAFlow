import { Injectable } from '@nestjs/common';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { env } from '../config/env';

/**
 * Local-disk storage for uploaded documents. Keys are generated server-side (never from user input),
 * files live outside any web-served directory and are only streamed back through authorised endpoints.
 * Swap for S3/Azure Blob by re-implementing these three methods.
 */
@Injectable()
export class StorageService {
  private readonly root = resolve(env().STORAGE_DIR);

  private pathFor(key: string): string {
    if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(key)) throw new Error('Invalid storage key');
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Storage key escapes root');
    return full;
  }

  async save(prefix: string, data: Buffer): Promise<string> {
    const key = `${prefix}/${new Date().getUTCFullYear()}/${randomUUID()}`;
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    return key;
  }

  stream(key: string): ReadStream {
    return createReadStream(this.pathFor(key));
  }
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

const ZIP_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const TEXT_TYPES: Record<string, string> = { csv: 'text/csv', txt: 'text/plain', eml: 'message/rfc822' };

/**
 * Determines the real file type from its content (magic bytes), not the client-supplied MIME type.
 * Returns null for anything not on the allow-list (executables, HTML, SVG, archives…).
 */
export function sniffDocumentType(buf: Buffer, fileName: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return ZIP_TYPES[ext] ?? null;
  if (TEXT_TYPES[ext]) {
    const head = buf.subarray(0, 8192);
    if (head.includes(0)) return null;
    const text = head.toString('utf8');
    if (text.includes('�')) return null;
    if (/<\s*(script|html|svg)/i.test(text)) return null;
    return TEXT_TYPES[ext]!;
  }
  return null;
}

export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned || 'document';
}
