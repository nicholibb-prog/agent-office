import { createHash } from 'node:crypto';

/** sha256 of the fields an approval is agreeing to. */
export function contentHash(job: { title: string; body: string; level: number; targetBot?: string }): string {
  return createHash('sha256').update([job.title, job.body, String(job.level), job.targetBot ?? ''].join('\0')).digest('hex');
}
