import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import {
  parseEvent,
  ClaimFiledEvent,
  VoteCastEvent,
  ClaimFinalizedEvent,
  ClaimPaidEvent,
  PolicyInitiatedEvent,
  PolicyRenewedEvent,
  PolicyTerminatedEvent,
} from '../events/events.schema';

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);
  private readonly BATCH_SIZE = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanService,
  ) {}

  async processNextBatch() {
    const state = await this.getState();
    const latestLedger = await this.soroban.getLatestLedger();

    if (state.lastLedger >= latestLedger) {
      return { processed: 0, lag: 0 };
    }

    const startLedger = state.lastLedger + 1;
    this.logger.debug(`Fetching events starting from ledger ${startLedger}`);

    const response = await this.soroban.getEvents(startLedger, this.BATCH_SIZE);
    const events = response.events || [];

    if (events.length === 0) {
      const newLastLedger = Math.min(startLedger + 100, latestLedger);
      await this.updateState(newLastLedger);
      return { processed: 0, lag: latestLedger - newLastLedger };
    }

    let processedCount = 0;
    for (let i = 0; i < events.length; i++) {
      await this.processEvent(events[i], i);
      processedCount++;
    }

    const maxLedger = Math.max(...events.map((e: any) => e.ledger));
    await this.updateState(maxLedger);

    return { processed: processedCount, lag: latestLedger - maxLedger };
  }

  private async getState() {
    let state = await this.prisma.indexerState.findFirst();
    if (!state) {
      state = await this.prisma.indexerState.create({ data: { lastLedger: 0 } });
    }
    return state;
  }

  private async updateState(lastLedger: number) {
    await this.prisma.indexerState.updateMany({
      data: { lastLedger, updatedAt: new Date() },
    });
  }

  private async processEvent(event: any, index: number) {
    const txHash: string = event.txHash;

    const topics: unknown[] = event.topic.map((t: string) => {
      try {
        return scValToNative(xdr.ScVal.fromXDR(t, 'base64'));
      } catch {
        return t;
      }
    });

    const dataNative = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64'));

    const parsed = parseEvent(topics, dataNative, event.ledger, txHash);

    await this.prisma.$transaction(async (tx) => {
      // Idempotent raw-event store — unique constraint on (txHash, eventIndex).
      await tx.rawEvent.upsert({
        where: { txHash_eventIndex: { txHash, eventIndex: index } },
        create: {
          txHash,
          eventIndex: index,
          contractId: event.contractId,
          ledger: event.ledger,
          ledgerClosedAt: new Date(event.ledgerClosedAt),
          topic1: String(topics[0] ?? ''),
          topic2: String(topics[1] ?? ''),
          topic3: topics[2] != null ? String(topics[2]) : null,
          topic4: topics[3] != null ? String(topics[3]) : null,
          data: dataNative,
        },
        update: {},
      });

      if (!parsed) return;

      switch (parsed.key) {
        case 'niffyinsure:PolicyInitiated':
          await this.handlePolicyInitiated(tx, parsed.payload as PolicyInitiatedEvent, parsed.ids, event);
          break;
        case 'niffyinsure:PolicyRenewed':
          await this.handlePolicyRenewed(tx, parsed.payload as PolicyRenewedEvent, parsed.ids);
          break;
        case 'niffyinsure:policy_terminated':
          await this.handlePolicyTerminated(tx, parsed.ids);
          break;
        case 'niffyins:clm_filed':
          await this.handleClaimFiled(tx, parsed.payload as ClaimFiledEvent, parsed.ids, event);
          break;
        case 'niffyins:vote_cast':
          await this.handleVoteCast(tx, parsed.payload as VoteCastEvent, parsed.ids, event);
          break;
        case 'niffyins:clm_final':
          await this.handleClaimFinalized(tx, parsed.payload as ClaimFinalizedEvent, parsed.ids);
          break;
        case 'niffyins:clm_paid':
          await this.handleClaimPaid(tx, parsed.payload as ClaimPaidEvent, parsed.ids, event);
          break;
        default:
          // Admin / config events are stored as raw events only.
          break;
      }
    });
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  private async handlePolicyInitiated(tx: any, data: PolicyInitiatedEvent, ids: unknown[], event: any) {
    // ids[0] = holder (Address string) from topic[2]
    const holder = String(ids[0]);
    const dbId = `${holder}:${data.policy_id}`;
    await tx.policy.upsert({
      where: { id: dbId },
      create: {
        id: dbId,
        policyId: data.policy_id,
        holderAddress: holder,
        policyType: data.policy_type,
        region: data.region,
        coverageAmount: data.coverage,
        premium: data.premium,
        isActive: true,
        startLedger: data.start_ledger,
        endLedger: data.end_ledger,
        txHash: event.txHash,
        eventIndex: 0,
      },
      update: { isActive: true, endLedger: data.end_ledger, updatedAt: new Date() },
    });
  }

  private async handlePolicyRenewed(tx: any, data: PolicyRenewedEvent, ids: unknown[]) {
    const holder = String(ids[0]);
    const dbId = `${holder}:${data.policy_id}`;
    await tx.policy.update({
      where: { id: dbId },
      data: { endLedger: data.new_end_ledger, updatedAt: new Date() },
    });
  }

  private async handlePolicyTerminated(tx: any, ids: unknown[]) {
    // ids[0] = holder, ids[1] = policy_id (u32)
    const holder = String(ids[0]);
    const policyId = Number(ids[1]);
    const dbId = `${holder}:${policyId}`;
    await tx.policy.update({
      where: { id: dbId },
      data: { isActive: false, updatedAt: new Date() },
    });
  }

  private async handleClaimFiled(tx: any, data: ClaimFiledEvent, ids: unknown[], event: any) {
    // ids[0] = claim_id (u64), ids[1] = holder (Address)
    const claimId = Number(ids[0]);
    const holder = String(ids[1]);
    const policyDbId = `${holder}:${data.policy_id}`;
    await tx.claim.upsert({
      where: { id: claimId },
      create: {
        id: claimId,
        policyId: policyDbId,
        creatorAddress: holder,
        amount: data.amount,
        status: 'PENDING',
        approveVotes: 0,
        rejectVotes: 0,
        createdAtLedger: data.filed_at,
        txHash: event.txHash,
      },
      update: { amount: data.amount },
    });
  }

  private async handleVoteCast(tx: any, data: VoteCastEvent, ids: unknown[], event: any) {
    // ids[0] = claim_id (u64), ids[1] = voter (Address)
    const claimId = Number(ids[0]);
    const voter = String(ids[1]);
    await tx.vote.upsert({
      where: { claimId_voterAddress: { claimId, voterAddress: voter } },
      create: {
        claimId,
        voterAddress: voter,
        vote: data.vote === 'Approve' ? 'APPROVE' : 'REJECT',
        votedAtLedger: data.at_ledger,
        txHash: event.txHash,
      },
      update: { vote: data.vote === 'Approve' ? 'APPROVE' : 'REJECT' },
    });
    await tx.claim.update({
      where: { id: claimId },
      data: { approveVotes: data.approve_votes, rejectVotes: data.reject_votes },
    });
  }

  private async handleClaimFinalized(tx: any, data: ClaimFinalizedEvent, ids: unknown[]) {
    const claimId = Number(ids[0]);
    await tx.claim.update({
      where: { id: claimId },
      data: {
        status: data.status === 'Approved' ? 'APPROVED' : 'REJECTED',
        approveVotes: data.approve_votes,
        rejectVotes: data.reject_votes,
        updatedAtLedger: data.at_ledger,
      },
    });
  }

  private async handleClaimPaid(tx: any, data: ClaimPaidEvent, ids: unknown[], event: any) {
    const claimId = Number(ids[0]);
    await tx.claim.update({
      where: { id: claimId },
      data: {
        status: 'PAID',
        paidAt: new Date(event.ledgerClosedAt),
        updatedAtLedger: data.at_ledger,
      },
    });
  }
}
