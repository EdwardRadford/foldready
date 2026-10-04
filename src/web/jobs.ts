// The job store as the routes and pages see it. The implementation behind these functions is
// chosen at runtime by getStore(): the file store on localhost (`next dev`, engine in-process),
// the D1 + R2 store on Cloudflare Workers. See src/web/store.ts.
import type { Job } from '@/engine/types';
import { getStore, type ShotResult, type StorageUsage } from './store';

export {
  RateLimitError,
  SHOT_FILES,
  isShotFile,
  shotContentType,
  getStore,
  statsContext,
  type ShotFile,
  type ShotResult,
  type JobStore,
} from './store';

/**
 * Queue a check. Returns an existing recent result for the same address instead of
 * running the browser twice, unless `fresh` is set or the cached result came from an older
 * engine. Throws UrlError (plain English) or RateLimitError.
 */
export async function createJob(input: string, ip = 'unknown', fresh = false, country?: string): Promise<Job> {
  return (await getStore()).createJob(input, ip, fresh, country);
}

export async function getJob(id: string): Promise<Job | undefined> {
  return (await getStore()).getJob(id);
}

/** All known jobs, newest first. For the admin table. */
export async function listJobs(): Promise<Job[]> {
  return (await getStore()).listJobs();
}

/** Drop a job from the store and delete its renders. */
export async function deleteJob(id: string): Promise<void> {
  return (await getStore()).deleteJob(id);
}

export async function queuePosition(id: string): Promise<number> {
  return (await getStore()).queuePosition(id);
}

/** One shot or clip, honouring a Range header. */
export async function getShot(
  id: string,
  file: string,
  rangeHeader: string | null,
): Promise<ShotResult> {
  return (await getStore()).getShot(id, file, rangeHeader);
}

/** Bytes held by renders, and where they live, for the admin page. */
export async function storageUsage(): Promise<StorageUsage> {
  return (await getStore()).usage();
}
