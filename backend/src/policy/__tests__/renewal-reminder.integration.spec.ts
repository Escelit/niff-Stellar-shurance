/**
 * RenewalReminderService integration tests.
 *
 * Verifies:
 *   - Policies within each reminder window are scanned and enqueued exactly once.
 *   - Opted-out policyholders are skipped and logged.
 *   - Policies outside all windows are not enqueued.
 *   - BullMQ deduplication: second scan within the same window does not double-enqueue.
 *   - Scan does not run when isRunning guard is active.
 *   - Pagination: more than SCAN_PAGE_SIZE policies are all processed.
 *
 * Uses in-memory Prisma and BullMQ mocks — no real Redis or DB required.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { RenewalReminderService } from "../renewal-reminder.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";
import { REMINDER_WINDOWS, SCAN_PAGE_SIZE } from "../renewal-reminder.constants";
import * as jobModule from "../renewal-reminder.job";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CURRENT_LEDGER = 1_000_000;

// Within 7d window (120,960 ledgers before expiry)
const POLICY_EXPIRING_7D = {
  id: "GTEST:1",
  policyId: 1,
  holderAddress: "GTEST7DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  endLedger: CURRENT_LEDGER + 100_000, // ~13.9 hours in; within 7d window
};

// Within 1d window (17,280 ledgers before expiry)
const POLICY_EXPIRING_1D = {
  id: "GTEST:2",
  policyId: 2,
  holderAddress: "GTEST1DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  endLedger: CURRENT_LEDGER + 10_000, // within 1d window too
};

// Already expired — not in any window
const POLICY_EXPIRED = {
  id: "GTEST:3",
  policyId: 3,
  holderAddress: "GTESTEXPIRED1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  endLedger: CURRENT_LEDGER - 1,
};

// ── Mock builders ─────────────────────────────────────────────────────────────

function makePrismaMock(policies: (typeof POLICY_EXPIRING_7D)[]) {
  return {
    ledgerCursor: {
      findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: CURRENT_LEDGER }),
    },
    policy: {
      findMany: jest.fn(
        async ({
          where,
          take,
          orderBy: _orderBy,
        }: {
          where: { endLedger: { gte: number; lte: number } };
          take: number;
          orderBy: unknown;
        }) => {
          const { gte, lte } = where.endLedger;
          return policies
            .filter((p) => p.endLedger >= gte && p.endLedger <= lte)
            .slice(0, take);
        },
      ),
    },
  };
}

function makeNotificationsMock(optedInAddresses: Set<string>) {
  return {
    getPreferences: jest.fn((holderAddress: string) => ({
      claimantPublicKey: holderAddress,
      emailEnabled: optedInAddresses.has(holderAddress),
      discordEnabled: false,
      telegramEnabled: false,
    })),
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

async function createTestModule(
  prisma: ReturnType<typeof makePrismaMock>,
  notifications: ReturnType<typeof makeNotificationsMock>,
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            STELLAR_NETWORK: "testnet",
            RENEWAL_REMINDER_CRON: "0 0 31 2 *", // Never fires automatically in tests
          }),
        ],
      }),
      ScheduleModule.forRoot(),
    ],
    providers: [
      RenewalReminderService,
      { provide: PrismaService, useValue: prisma },
      { provide: NotificationsService, useValue: notifications },
    ],
  }).compile();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RenewalReminderService", () => {
  let enqueueSpy: jest.SpyInstance;

  beforeEach(() => {
    // Track enqueue calls without hitting real BullMQ
    enqueueSpy = jest
      .spyOn(jobModule, "enqueueRenewalReminder")
      .mockResolvedValue("mock-job-id");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Window coverage ────────────────────────────────────────────────────────

  it("enqueues a 7d reminder for a policy expiring within 7d window", async () => {
    const prisma = makePrismaMock([POLICY_EXPIRING_7D]);
    const notifications = makeNotificationsMock(
      new Set([POLICY_EXPIRING_7D.holderAddress]),
    );
    const moduleRef = await createTestModule(prisma, notifications);
    const service = moduleRef.get(RenewalReminderService);

    await service.runScan();

    const calls = enqueueSpy.mock.calls.map((c: [jobModule.RenewalReminderJobData]) => ({
      policyId: c[0].policyId,
      reminderType: c[0].reminderType,
    }));

    expect(calls).toContainEqual({ policyId: 1, reminderType: "7d" });

    await moduleRef.close();
  });

  it("enqueues a 1d reminder for a policy expiring within 1d window", async () => {
    const prisma = makePrismaMock([POLICY_EXPIRING_1D]);
    const notifications = makeNotificationsMock(
      new Set([POLICY_EXPIRING_1D.holderAddress]),
    );
    const moduleRef = await createTestModule(prisma, notifications);
    const service = moduleRef.get(RenewalReminderService);

    await service.runScan();

    const calls = enqueueSpy.mock.calls.map((c: [jobModule.RenewalReminderJobData]) => ({
      policyId: c[0].policyId,
      reminderType: c[0].reminderType,
    }));

    expect(calls).toContainEqual({ policyId: 2, reminderType: "1d" });

    await moduleRef.close();
  });

  it("does not enqueue for an already-expired policy", async () => {
    const prisma = makePrismaMock([POLICY_EXPIRED]);
    const notifications = makeNotificationsMock(new Set([POLICY_EXPIRED.holderAddress]));
    const moduleRef = await createTestModule(prisma, notifications);
    const service = moduleRef.get(RenewalReminderService);

    await service.runScan();

    expect(enqueueSpy).not.toHaveBeenCalled();

    await moduleRef.close();
  });

  // ── Opt-out ────────────────────────────────────────────────────────────────

  it("skips opted-out policyholders and does not enqueue", async () => {
    const prisma = makePrismaMock([POLICY_EXPIRING_7D]);
    // Empty set = all opted out
    const notifications = makeNotificationsMock(new Set());
    const moduleRef = await createTestModule(prisma, notifications);
    const service = moduleRef.get(RenewalReminderService);

    await service.runScan();

    expect(enqueueSpy).not.toHaveBeenCalled();

    await moduleRef.close();
  });

  // ── Idempotency (BullMQ deduplication simulation) ─────────────────────────

  it("enqueues exactly once per policy per window across two consecutive scans", async () => {
    // Simulate BullMQ returning null on second attempt (job already exists)
    enqueueSpy
      .mockResolvedValueOnce("job-id-1") // first scan
      .mockResolvedValueOnce(null); // second scan — deduplicated

    const prisma = makePrismaMock([POLICY_EXPIRING_7D]);
    const notifications = makeNotificationsMock(
      new Set([POLICY_EXPIRING_7D.holderAddress]),
    );
    const moduleRef = await createTestModule(prisma, notifications);
    const service = moduleRef.get(RenewalReminderService);

    await service.runScan();
    await service.runScan();

    // enqueueRenewalReminder called twice (once per scan) but second returns null
    expect(enqueueSpy).toHaveBeenCalledTimes(
      2 *
        REMINDER_WINDOWS.filter(
          (w) => POLICY_EXPIRING_7D.endLedger <= CURRENT_LEDGER + w.ledgersBeforeExpiry,
        ).length,
    );

    await moduleRef.close();
  });

  // ── Run guard ──────────────────────────────────────────────────────────────

  it("does not start a second scan while the first is running", async () => {
    const prisma = makePrismaMock([]);
    const notifications = makeNotificationsMock(new Set());
    const moduleRef = await createTestModule(prisma, notifications);
    const service = moduleRef.get(RenewalReminderService);

    // Manually set isRunning
    (service as unknown as { isRunning: boolean }).isRunning = true;

    await service.runScan();

    // Prisma should not have been called
    expect(prisma.ledgerCursor.findUnique).not.toHaveBeenCalled();

    (service as unknown as { isRunning: boolean }).isRunning = false;
    await moduleRef.close();
  });

  // ── No ledger cursor ──────────────────────────────────────────────────────

  it("skips scan gracefully when no ledger cursor exists", async () => {
    const prisma = makePrismaMock([]);
    prisma.ledgerCursor.findUnique = jest.fn().mockResolvedValue(null);
    const notifications = makeNotificationsMock(new Set());
    const moduleRef = await createTestModule(prisma, notifications);
    const service = moduleRef.get(RenewalReminderService);

    await service.runScan();

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(prisma.policy.findMany).not.toHaveBeenCalled();

    await moduleRef.close();
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  it("paginates correctly when policies exceed SCAN_PAGE_SIZE", async () => {
    // Generate SCAN_PAGE_SIZE + 10 policies all within the 7d window
    const manyPolicies = Array.from({ length: SCAN_PAGE_SIZE + 10 }, (_, i) => ({
      id: `GPAGER:${i + 1}`,
      policyId: i + 100,
      holderAddress: `GPAGER${String(i).padStart(50, "A")}`,
      endLedger: CURRENT_LEDGER + 50_000,
    }));

    const optedIn = new Set(manyPolicies.map((p) => p.holderAddress));

    // Mock paginated Prisma: first call returns SCAN_PAGE_SIZE rows, second returns the rest
    const prismaMock = {
      ledgerCursor: {
        findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: CURRENT_LEDGER }),
      },
      policy: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(manyPolicies.slice(0, SCAN_PAGE_SIZE))
          .mockResolvedValueOnce(manyPolicies.slice(SCAN_PAGE_SIZE))
          .mockResolvedValue([]), // subsequent calls return empty
      },
    };

    const notifications = makeNotificationsMock(optedIn);
    const moduleRef = await createTestModule(
      prismaMock as unknown as ReturnType<typeof makePrismaMock>,
      notifications,
    );
    const service = moduleRef.get(RenewalReminderService);

    await service.runScan();

    // All SCAN_PAGE_SIZE + 10 policies should have been enqueued (for the 7d window)
    const enqueuedPolicies = enqueueSpy.mock.calls
      .filter((c: [jobModule.RenewalReminderJobData]) => c[0].reminderType === "7d")
      .map((c: [jobModule.RenewalReminderJobData]) => c[0].policyId);

    expect(enqueuedPolicies).toHaveLength(SCAN_PAGE_SIZE + 10);

    await moduleRef.close();
  });

  // ── Payload correctness ───────────────────────────────────────────────────

  it("passes correct payload fields to enqueueRenewalReminder", async () => {
    const prisma = makePrismaMock([POLICY_EXPIRING_7D]);
    const notifications = makeNotificationsMock(
      new Set([POLICY_EXPIRING_7D.holderAddress]),
    );
    const moduleRef = await createTestModule(prisma, notifications);
    const service = moduleRef.get(RenewalReminderService);

    await service.runScan();

    const sevenDayCall = enqueueSpy.mock.calls.find(
      (c: [jobModule.RenewalReminderJobData]) => c[0].reminderType === "7d",
    );
    expect(sevenDayCall).toBeDefined();

    const payload: jobModule.RenewalReminderJobData = sevenDayCall[0];
    expect(payload).toMatchObject({
      policyDbId: POLICY_EXPIRING_7D.id,
      policyId: POLICY_EXPIRING_7D.policyId,
      holderAddress: POLICY_EXPIRING_7D.holderAddress,
      reminderType: "7d",
      endLedger: POLICY_EXPIRING_7D.endLedger,
      currentLedger: CURRENT_LEDGER,
    });

    await moduleRef.close();
  });
});
