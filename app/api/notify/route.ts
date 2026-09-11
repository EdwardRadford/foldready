import { promises as fs } from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'notify.jsonl');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: Request) {
  let email = '';
  let url = '';
  let jobId = '';
  try {
    const body = (await req.json()) as { email?: unknown; url?: unknown; jobId?: unknown };
    email = typeof body.email === 'string' ? body.email.trim() : '';
    url = typeof body.url === 'string' ? body.url : '';
    jobId = typeof body.jobId === 'string' ? body.jobId : '';
  } catch {
    return Response.json({ error: 'Send an email address.' }, { status: 400 });
  }

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return Response.json({ error: 'That does not look like an email address.' }, { status: 400 });
  }

  const line = JSON.stringify({ email, url, jobId, at: new Date().toISOString() }) + '\n';
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.appendFile(FILE, line, 'utf8');
  } catch {
    return Response.json({ error: 'That did not save. Try again in a minute.' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
