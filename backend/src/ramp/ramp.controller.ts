import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { Feature } from '../feature-flags/feature.decorator';
import { RAMP_FEATURE_FLAG, RAMP_WEBHOOK_SECRET_HEADER } from './ramp.constants';

interface RampPurchaseCompletedPayload {
  type: 'PURCHASE_CREATED' | 'PURCHASE_FAILED' | 'PURCHASE_REFUNDED';
  purchase: {
    id: string;
    status: 'COMPLETE' | 'FAILED' | 'REFUNDED';
    finalTxHash?: string;
    receiverAddress: string;
    cryptoAmount: string;
    cryptoCurrency: string;
    fiatValue: number;
    fiatCurrency: string;
    purchaseViewToken?: string;
  };
}

@Controller('ramp')
export class RampController {
  private readonly logger = new Logger(RampController.name);

  constructor(private readonly config: ConfigService) {}

  @Get('config')
  @Feature(RAMP_FEATURE_FLAG)
  getConfig(@Headers('x-region') region: string | undefined) {
    const allowedRegions = (this.config.get<string>('RAMP_ALLOWED_REGIONS') ?? '')
      .split(',')
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean);
    const normalised = (region ?? '').toUpperCase();

    if (allowedRegions.length > 0 && !allowedRegions.includes(normalised)) {
      throw new NotFoundException('Ramp not available in your region');
    }

    const baseUrl = this.config.get<string>('RAMP_URL') ?? '';
    const url = new URL(baseUrl);
    url.searchParams.set('utm_source', this.config.get<string>('RAMP_UTM_SOURCE', 'niffyinsure'));
    url.searchParams.set('utm_medium', this.config.get<string>('RAMP_UTM_MEDIUM', 'app'));
    url.searchParams.set('utm_campaign', this.config.get<string>('RAMP_UTM_CAMPAIGN', 'onramp'));

    return { url: url.toString() };
  }

  /**
   * Ramp Network webhook endpoint.
   *
   * Security: HMAC-SHA256 signature verification using RAMP_WEBHOOK_SECRET.
   * Signature is in the `x-body-signature-sha256` header as a hex digest.
   *
   * Flow:
   *   PURCHASE_CREATED (status=COMPLETE) -> log successful payment
   *   PURCHASE_FAILED / PURCHASE_REFUNDED -> log failure, no orphaned policy
   */
  @Post('webhook')
  @HttpCode(200)
  @Feature(RAMP_FEATURE_FLAG)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers(RAMP_WEBHOOK_SECRET_HEADER) signature: string | undefined,
    @Body() payload: RampPurchaseCompletedPayload,
  ): Promise<{ received: boolean }> {
    this.verifySignature(req.rawBody, signature);

    const { type, purchase } = payload;

    if (!purchase?.id || !type) {
      throw new BadRequestException('Invalid Ramp webhook payload');
    }

    switch (type) {
      case 'PURCHASE_CREATED':
        if (purchase.status === 'COMPLETE') {
          this.logger.log(
            `Ramp payment confirmed: purchaseId=${purchase.id} ` +
            `receiver=${purchase.receiverAddress} ` +
            `amount=${purchase.cryptoAmount} ${purchase.cryptoCurrency}`,
          );
        }
        break;
      case 'PURCHASE_FAILED':
        this.logger.warn(`Ramp payment failed: purchaseId=${purchase.id} receiver=${purchase.receiverAddress}`);
        break;
      case 'PURCHASE_REFUNDED':
        this.logger.warn(`Ramp payment refunded: purchaseId=${purchase.id} receiver=${purchase.receiverAddress}`);
        break;
      default:
        this.logger.debug(`Ramp webhook: unhandled event type=${type}`);
    }

    return { received: true };
  }

  private verifySignature(rawBody: Buffer | undefined, signature: string | undefined): void {
    const secret = this.config.get<string>('RAMP_WEBHOOK_SECRET');
    if (!secret) {
      if (this.config.get<string>('NODE_ENV') !== 'development') {
        throw new UnauthorizedException('Ramp webhook secret not configured');
      }
      return;
    }

    if (!signature || !rawBody) {
      throw new UnauthorizedException('Missing Ramp webhook signature');
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException('Invalid Ramp webhook signature');
    }
  }
}
