import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { Result } from '@/engine/types';
import ResultView from '../../_components/ResultView';
import sample from '../../../fixtures/sample-result.json';

// Development only: a fixed Result for working on the layout. The screenshots do not exist,
// so every frame falls back to its flat placeholder.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sample result — Fold Ready',
  robots: { index: false, follow: false },
};

export default function SamplePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ResultView result={sample as unknown as Result} />;
}
