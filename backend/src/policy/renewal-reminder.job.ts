/**
 * Renewal reminder job payload and queue producer.
 *
 * Each enqueued job represents one notification to be sent for one policy
 * in one reminder window. The worker (NotificationsService or equivalent)
 * consumes these jobs and delivers the notification via the configured channel.
 *
 * Job ID: `renewal-reminder:{policyId}:{reminderType}`
 * BullMQ deduplicates on job ID — adding a job with an existing ID is a no-op
 * when the job is still pending. This is the primary idempotency mechanism.
 */

import { Queue } from "bullmq";
import { getBullMQConnection } from "../redis/client";
import {
  REMINDER_QUEUE_NAME,
  REMINDER_JOB_OPTIONS,
  ReminderType,
} from "./renewal-reminder.constants";

export interface RenewalReminderJobData {
  /** Compound policy DB id: "{holderAddress}:{policyId}" */
  policyDbId: string;
  /** Numeric on-chain policy ID */
  policyId: number;
  /** Stellar address of the policyholder */
  holderAddress: string;
  /** Reminder window that triggered this job */
  reminderType: ReminderType;
  /** Ledger at which the policy expires */
  endLedger: number;
  /** Current ledger at scan time — used for ETA calculation in the notification */
  currentLedger: number;
}

let _queue: Queue<RenewalReminderJobData> | null = null;

export function getRenewalReminderQueue(): Queue<RenewalReminderJobData> {
  if (!_queue) {
    _queue = new Queue<RenewalReminderJobData>(REMINDER_QUEUE_NAME, {
      connection: getBullMQConnection(),
      defaultJobOptions: REMINDER_JOB_OPTIONS,
    });
  }
  return _queue;
}

/**
 * Enqueue a renewal reminder job.
 * Job ID is deterministic on (policyId, reminderType) — BullMQ rejects
 * duplicates when a job with that ID is already waiting/active/delayed.
 *
 * Returns the job ID if enqueued, or null if deduplicated (already exists).
 */
export async function enqueueRenewalReminder(
  data: RenewalReminderJobData,
): Promise<string | null> {
  const queue = getRenewalReminderQueue();
  const jobId = `renewal-reminder:${data.policyId}:${data.reminderType}`;

  const job = await queue.add(`renewal-reminder:${data.reminderType}`, data, {
    ...REMINDER_JOB_OPTIONS,
    jobId,
  });

  return job.id ?? null;
}

export async function closeRenewalReminderQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}
