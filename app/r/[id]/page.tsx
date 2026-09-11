import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getJob } from '@/web/jobs';
import Poller from './Poller';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your Duo check — Fold Ready',
  robots: { index: false, follow: false },
};

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  return <Poller initial={job} />;
}
