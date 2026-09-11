import type { CSSProperties } from 'react';

/** Custom properties in a style object, without fighting the CSSProperties type. */
export function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

export function shotUrl(jobId: string, file: string): string {
  return `/api/shot/${encodeURIComponent(jobId)}/${encodeURIComponent(file)}`;
}
