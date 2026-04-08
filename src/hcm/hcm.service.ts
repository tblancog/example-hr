import { Injectable, Inject } from '@nestjs/common';
import { HcmUnavailableException } from '../common/exceptions/hcm-unavailable.exception';
import { InsufficientBalanceException } from '../common/exceptions/insufficient-balance.exception';
import { InvalidDimensionException } from '../common/exceptions/invalid-dimension.exception';

interface HcmConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface HcmBalanceData {
  available: number;
  used: number;
  total: number;
}

@Injectable()
export class HcmService {
  constructor(@Inject('HCM_CONFIG') private readonly config: HcmConfig) {}

  private async fetchHcm(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err: any) {
      if (err.name === 'AbortError') throw new HcmUnavailableException('timeout');
      throw new HcmUnavailableException(err.message ?? 'network_error');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getBalance(employeeId: string, locationId: string): Promise<HcmBalanceData> {
    const resp = await this.fetchHcm(`${this.config.baseUrl}/hcm/balance/${employeeId}/${locationId}`);
    const body = await resp.json();
    if (resp.ok) return body as HcmBalanceData;
    if (resp.status === 404) throw new InvalidDimensionException(employeeId, locationId);
    throw new HcmUnavailableException(body.error ?? 'server_error');
  }

  async setBalance(employeeId: string, locationId: string, balance: HcmBalanceData): Promise<HcmBalanceData> {
    const resp = await this.fetchHcm(`${this.config.baseUrl}/hcm/balance/${employeeId}/${locationId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(balance),
    });
    const body: any = await resp.json().catch(() => ({}));
    if (resp.ok) return body as HcmBalanceData;
    if (resp.status === 400 && body.error === 'insufficient_balance') {
      throw new InsufficientBalanceException(balance.available, 0);
    }
    if (resp.status === 422) throw new InvalidDimensionException(employeeId, locationId);
    throw new HcmUnavailableException(body.error ?? `status_${resp.status}`);
  }
}
