/** Redis key for the latest solvency snapshot (admin dashboard reads only this). */
export const SOLVENCY_SNAPSHOT_REDIS_KEY = 'solvency:snapshot:v1';

/** TTL so a stale key eventually expires if the job stops; refreshed each successful run. */
export const SOLVENCY_SNAPSHOT_TTL_SECONDS = 60 * 60 * 24 * 7;
