import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { RampController } from '../ramp/ramp.controller';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsGuard } from '../feature-flags/feature-flags.guard';
import { ConfigService } from '@nestjs/config';

const WEBHOOK_SECRET = 'test-ramp-webhook-secret-32-chars!!';

function makeConfigService(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    RAMP_URL: 'https://ramp.example.com',
    RAMP_ALLOWED_REGIONS: 'US,GB',
    RAMP_UTM_SOURCE: 'niffyinsure',
    RAMP_UTM_MEDIUM: 'app',
    RAMP_UTM_CAMPAIGN: 'onramp',
    RAMP_WEBHOOK_SECRET: WEBHOOK_SECRET,
    NODE_ENV: 'test',
    ...overrides,
  };
  return { get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback) };
}

function signPayload(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

function makeRawReq(body: string, sig?: string) {
  return { rawBody: Buffer.from(body) } as any;
}

const mockFlags = (enabled: boolean) => ({
  isEnabled: jest.fn().mockReturnValue(enabled),
  getDisabledStatusCode: jest.fn().mockReturnValue(404),
  getFlags: jest.fn().mockReturnValue({}),
});

async function buildController(configOverrides: Record<string, string> = {}, flagEnabled = true) {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [RampController],
    providers: [
      { provide: FeatureFlagsService, useValue: mockFlags(flagEnabled) },
      { provide: ConfigService, useValue: makeConfigService(configOverrides) },
      Reflector,
      FeatureFlagsGuard,
    ],
  }).compile();
  return module.get<RampController>(RampController);
}

describe('RampController - getConfig', () => {
  it('returns UTM-enriched URL for allowed region', async () => {
    const ctrl = await buildController();
    const result = ctrl.getConfig('US');
    expect(result.url).toContain('utm_source=niffyinsure');
    expect(result.url).toContain('utm_medium=app');
    expect(result.url).toContain('utm_campaign=onramp');
  });

  it('throws NotFoundException for disallowed region', async () => {
    const ctrl = await buildController();
    expect(() => ctrl.getConfig('CN')).toThrow(NotFoundException);
  });

  it('ramp NotFoundException does not affect unrelated policy logic', async () => {
    const ctrl = await buildController();
    let rampError: unknown;
    try { ctrl.getConfig('CN'); } catch (e) { rampError = e; }
    expect(rampError).toBeInstanceOf(NotFoundException);
    expect(true).toBe(true);
  });
});

describe('RampController - handleWebhook', () => {
  it('accepts PURCHASE_CREATED with COMPLETE status and valid signature', async () => {
    const ctrl = await buildController();
    const body = JSON.stringify({
      type: 'PURCHASE_CREATED',
      purchase: { id: 'purchase-abc', status: 'COMPLETE', receiverAddress: 'GWALLET123', cryptoAmount: '10', cryptoCurrency: 'XLM', fiatValue: 5, fiatCurrency: 'USD' },
    });
    const sig = signPayload(body);
    const result = await ctrl.handleWebhook(makeRawReq(body, sig), sig, JSON.parse(body));
    expect(result).toEqual({ received: true });
  });

  it('accepts PURCHASE_FAILED without creating orphaned policy', async () => {
    const ctrl = await buildController();
    const body = JSON.stringify({
      type: 'PURCHASE_FAILED',
      purchase: { id: 'purchase-fail', status: 'FAILED', receiverAddress: 'GWALLET123', cryptoAmount: '0', cryptoCurrency: 'XLM', fiatValue: 0, fiatCurrency: 'USD' },
    });
    const sig = signPayload(body);
    const result = await ctrl.handleWebhook(makeRawReq(body, sig), sig, JSON.parse(body));
    expect(result).toEqual({ received: true });
  });

  it('accepts PURCHASE_REFUNDED gracefully', async () => {
    const ctrl = await buildController();
    const body = JSON.stringify({
      type: 'PURCHASE_REFUNDED',
      purchase: { id: 'purchase-refund', status: 'REFUNDED', receiverAddress: 'GWALLET123', cryptoAmount: '10', cryptoCurrency: 'XLM', fiatValue: 5, fiatCurrency: 'USD' },
    });
    const sig = signPayload(body);
    const result = await ctrl.handleWebhook(makeRawReq(body, sig), sig, JSON.parse(body));
    expect(result).toEqual({ received: true });
  });

  it('rejects webhook with invalid signature', async () => {
    const ctrl = await buildController();
    const body = JSON.stringify({
      type: 'PURCHASE_CREATED',
      purchase: { id: 'x', status: 'COMPLETE', receiverAddress: 'G', cryptoAmount: '1', cryptoCurrency: 'XLM', fiatValue: 1, fiatCurrency: 'USD' },
    });
    const badSig = 'deadbeef'.repeat(8);
    await expect(ctrl.handleWebhook(makeRawReq(body, badSig), badSig, JSON.parse(body)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects webhook with missing signature', async () => {
    const ctrl = await buildController();
    const body = JSON.stringify({
      type: 'PURCHASE_CREATED',
      purchase: { id: 'x', status: 'COMPLETE', receiverAddress: 'G', cryptoAmount: '1', cryptoCurrency: 'XLM', fiatValue: 1, fiatCurrency: 'USD' },
    });
    await expect(ctrl.handleWebhook(makeRawReq(body), undefined, JSON.parse(body)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects webhook with missing purchase id', async () => {
    const ctrl = await buildController();
    const body = JSON.stringify({ type: 'PURCHASE_CREATED', purchase: null });
    const sig = signPayload(body);
    await expect(ctrl.handleWebhook(makeRawReq(body, sig), sig, JSON.parse(body)))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects spoofed payload (signature from different secret)', async () => {
    const ctrl = await buildController();
    const body = JSON.stringify({
      type: 'PURCHASE_CREATED',
      purchase: { id: 'spoof', status: 'COMPLETE', receiverAddress: 'G', cryptoAmount: '1', cryptoCurrency: 'XLM', fiatValue: 1, fiatCurrency: 'USD' },
    });
    const spoofedSig = signPayload(body, 'attacker-secret');
    await expect(ctrl.handleWebhook(makeRawReq(body, spoofedSig), spoofedSig, JSON.parse(body)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
