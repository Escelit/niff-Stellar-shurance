import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SolvencyMonitoringService } from './solvency-monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { RedisService } from '../cache/redis.service';
import { SOLVENCY_SNAPSHOT_REDIS_KEY } from './solvency.constants';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn().mockResolvedValue({ status: 200 }),
  },
}));

const axiosPost = axios.post as jest.Mock;

describe('SolvencyMonitoringService', () => {
  let service: SolvencyMonitoringService;
  let prisma: { $queryRaw: jest.Mock };
  let soroban: { simulateGetTreasuryBalance: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };
  let config: Record<string, string>;

  beforeEach(async () => {
    jest.clearAllMocks();
    config = {
      SOLVENCY_MONITORING_ENABLED: 'true',
      SOLVENCY_BUFFER_THRESHOLD_STROOPS: '100',
      SOLVENCY_SIMULATION_SOURCE_ACCOUNT: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      CONTRACT_ID: 'CDEMO',
      SOLVENCY_ALERT_WEBHOOK_URL: '',
      SOLVENCY_ALERT_WEBHOOK_SECRET: '',
      SOLVENCY_TENANT_ID: '',
    };

    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ s: '500' }]),
    };
    soroban = {
      simulateGetTreasuryBalance: jest.fn().mockResolvedValue({
        balanceStroops: '1000',
        minResourceFee: '100',
      }),
    };
    redis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SolvencyMonitoringService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: string) =>
              Object.prototype.hasOwnProperty.call(config, key)
                ? config[key as keyof typeof config]
                : def,
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: SorobanService, useValue: soroban },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(SolvencyMonitoringService);
  });

  describe('getLatestSnapshot', () => {
    it('reads Redis only', async () => {
      const snap = { status: 'ok' as const, checkedAt: 't', thresholdStroops: '0', alertEmitted: false };
      redis.get.mockResolvedValueOnce(snap);
      await expect(service.getLatestSnapshot()).resolves.toEqual(snap);
      expect(redis.get).toHaveBeenCalledWith(SOLVENCY_SNAPSHOT_REDIS_KEY);
      expect(soroban.simulateGetTreasuryBalance).not.toHaveBeenCalled();
    });
  });

  describe('runSolvencyCheck', () => {
    it('sets unknown when RPC fails without emitting buffer-low alert or webhook', async () => {
      config.SOLVENCY_ALERT_WEBHOOK_URL = 'https://hooks.example/solvency';
      soroban.simulateGetTreasuryBalance.mockRejectedValueOnce(new Error('rpc down'));

      const snap = await service.runSolvencyCheck();

      expect(snap.status).toBe('unknown');
      expect(snap.alertEmitted).toBe(false);
      expect(snap.rpcError).toContain('rpc down');
      expect(snap.outstandingApprovedStroops).toBe('500');
      expect(redis.set).toHaveBeenCalled();
      expect(axiosPost).not.toHaveBeenCalled();
    });

    it('sets degraded and calls webhook when buffer is below threshold', async () => {
      config.SOLVENCY_ALERT_WEBHOOK_URL = 'https://hooks.example/solvency';
      config.SOLVENCY_ALERT_WEBHOOK_SECRET = 'secret';
      prisma.$queryRaw.mockResolvedValueOnce([{ s: '950' }]);
      soroban.simulateGetTreasuryBalance.mockResolvedValueOnce({
        balanceStroops: '1000',
        minResourceFee: '100',
      });

      const snap = await service.runSolvencyCheck();

      expect(snap.status).toBe('degraded');
      expect(snap.bufferStroops).toBe('50');
      expect(snap.alertEmitted).toBe(true);
      expect(axiosPost).toHaveBeenCalledWith(
        'https://hooks.example/solvency',
        expect.objectContaining({
          event: 'solvency_buffer_low',
          severity: 'critical',
          bufferStroops: '50',
        }),
        expect.objectContaining({
          headers: { 'X-Webhook-Secret': 'secret' },
        }),
      );
    });

    it('sets ok when buffer meets threshold', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ s: '200' }]);
      soroban.simulateGetTreasuryBalance.mockResolvedValueOnce({
        balanceStroops: '1000',
        minResourceFee: '100',
      });

      const snap = await service.runSolvencyCheck();

      expect(snap.status).toBe('ok');
      expect(snap.bufferStroops).toBe('800');
      expect(snap.alertEmitted).toBe(false);
      expect(axiosPost).not.toHaveBeenCalled();
    });

    it('sets unknown when simulation source account is missing', async () => {
      config.SOLVENCY_SIMULATION_SOURCE_ACCOUNT = '';
      const snap = await service.runSolvencyCheck();
      expect(snap.status).toBe('unknown');
      expect(snap.skipReason).toContain('SOLVENCY_SIMULATION_SOURCE_ACCOUNT');
      expect(soroban.simulateGetTreasuryBalance).not.toHaveBeenCalled();
    });

    it('sets unknown when monitoring disabled', async () => {
      config.SOLVENCY_MONITORING_ENABLED = 'false';
      const snap = await service.runSolvencyCheck();
      expect(snap.status).toBe('unknown');
      expect(snap.skipReason).toContain('SOLVENCY_MONITORING_ENABLED');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
