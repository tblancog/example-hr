import * as http from 'http';
import * as express from 'express';
import { Express, Request, Response } from 'express';
import { HcmBalance, HcmCall } from '../types';
import { ScenarioType } from '../../src/common/enums';

interface HcmMockState {
  balances: Map<string, HcmBalance>;
  scenarios: {
    timeout: Set<string>;
    invalidDimension: Set<string>;
    internalError: Set<string>;
    insufficientBalance: Set<string>;
  };
  callLog: HcmCall[];
  processedSyncIds: Set<string>;
  // For race simulation: nth SET call on a key fails
  setFailOnCall: Map<string, number>; // key -> fail on this call index (1-based)
  setCallCount: Map<string, number>;  // key -> current call count
}

export class HcmMockServer {
  private app: Express;
  private server: http.Server;
  private state: HcmMockState;
  private _url: string = '';
  private readonly port: number;

  constructor(port = 0) {
    this.port = port;
    this.state = this.freshState();
    this.app = express();
    this.app.use(express.json());
    this.registerRoutes();
    this.server = http.createServer(this.app);
  }

  private freshState(): HcmMockState {
    return {
      balances: new Map(),
      scenarios: {
        timeout: new Set(),
        invalidDimension: new Set(),
        internalError: new Set(),
        insufficientBalance: new Set(),
      },
      callLog: [],
      processedSyncIds: new Set(),
      setFailOnCall: new Map(),
      setCallCount: new Map(),
    };
  }

  private balanceKey(employeeId: string, locationId: string): string {
    return `${employeeId}:${locationId}`;
  }

  private log(call: Omit<HcmCall, 'timestamp'>): void {
    this.state.callLog.push({ ...call, timestamp: new Date().toISOString() });
  }

  private registerRoutes(): void {
    // ─── Real HCM API ───────────────────────────────────────────────────────

    // GET /hcm/balance/:employeeId/:locationId
    this.app.get('/hcm/balance/:employeeId/:locationId', async (req: Request, res: Response) => {
      const employeeId = req.params['employeeId'] as string;
      const locationId = req.params['locationId'] as string;
      const key = this.balanceKey(employeeId, locationId);

      this.log({ method: 'GET', path: req.path, employeeId, locationId, responseStatus: 0 });

      if (this.state.scenarios.timeout.has(key)) {
        // hang — let test timeout handle it; update log status
        this.state.callLog[this.state.callLog.length - 1].responseStatus = 0;
        await new Promise((resolve) => setTimeout(resolve, 15000));
        return res.status(504).json({ error: 'gateway_timeout' });
      }

      if (this.state.scenarios.invalidDimension.has(key)) {
        this.state.callLog[this.state.callLog.length - 1].responseStatus = 404;
        return res.status(404).json({ error: 'invalid_dimension', employeeId, locationId });
      }

      if (this.state.scenarios.internalError.has(key)) {
        this.state.callLog[this.state.callLog.length - 1].responseStatus = 500;
        return res.status(500).json({ error: 'internal_server_error' });
      }

      const balance = this.state.balances.get(key);
      if (!balance) {
        this.state.callLog[this.state.callLog.length - 1].responseStatus = 404;
        return res.status(404).json({ error: 'invalid_dimension', employeeId, locationId });
      }

      this.state.callLog[this.state.callLog.length - 1].responseStatus = 200;
      return res.status(200).json({ available: balance.available, used: balance.used, total: balance.total });
    });

    // PUT /hcm/balance/:employeeId/:locationId
    this.app.put('/hcm/balance/:employeeId/:locationId', (req: Request, res: Response) => {
      const employeeId = req.params['employeeId'] as string;
      const locationId = req.params['locationId'] as string;
      const key = this.balanceKey(employeeId, locationId);
      const body = req.body as { available?: number; used?: number; total?: number };

      this.log({ method: 'SET', path: req.path, employeeId, locationId, body, responseStatus: 0 });

      // Race simulation: fail on nth SET call
      if (this.state.setFailOnCall.has(key)) {
        const current = (this.state.setCallCount.get(key) ?? 0) + 1;
        this.state.setCallCount.set(key, current);
        if (current >= (this.state.setFailOnCall.get(key) ?? Infinity)) {
          this.state.callLog[this.state.callLog.length - 1].responseStatus = 400;
          return res.status(400).json({ error: 'insufficient_balance' });
        }
      }

      if (this.state.scenarios.insufficientBalance.has(key)) {
        this.state.callLog[this.state.callLog.length - 1].responseStatus = 400;
        return res.status(400).json({ error: 'insufficient_balance' });
      }

      if (this.state.scenarios.internalError.has(key)) {
        this.state.callLog[this.state.callLog.length - 1].responseStatus = 500;
        return res.status(500).json({ error: 'internal_server_error' });
      }

      if (this.state.scenarios.invalidDimension.has(key)) {
        this.state.callLog[this.state.callLog.length - 1].responseStatus = 422;
        return res.status(422).json({ error: 'invalid_dimension' });
      }

      const available = body.available ?? 0;
      const used = body.used ?? 0;
      const total = body.total ?? (this.state.balances.get(key)?.total ?? 0);

      if (available < 0) {
        this.state.callLog[this.state.callLog.length - 1].responseStatus = 400;
        return res.status(400).json({ error: 'insufficient_balance' });
      }

      const updated: HcmBalance = { employeeId, locationId, available, used, total };
      this.state.balances.set(key, updated);

      this.state.callLog[this.state.callLog.length - 1].responseStatus = 200;
      return res.status(200).json({ available: updated.available, used: updated.used, total: updated.total });
    });

    // GET /hcm/batch-balances
    this.app.get('/hcm/batch-balances', (_req: Request, res: Response) => {
      this.log({ method: 'BATCH', path: '/hcm/batch-balances', responseStatus: 200 });
      const balances = Array.from(this.state.balances.values());
      return res.status(200).json({ balances });
    });

    // ─── Test-control endpoints ──────────────────────────────────────────────

    this.app.post('/hcm/_test/seed', (req: Request, res: Response) => {
      const balance = req.body as HcmBalance;
      this.state.balances.set(this.balanceKey(String(balance.employeeId), String(balance.locationId)), balance);
      this.log({ method: 'TEST', path: '/hcm/_test/seed', body: req.body, responseStatus: 200 });
      return res.status(200).json({ ok: true });
    });

    this.app.post('/hcm/_test/scenario', (req: Request, res: Response) => {
      const { key, type } = req.body as { key: string; type: ScenarioType };
      switch (type) {
        case ScenarioType.TIMEOUT:
          this.state.scenarios.timeout.add(key);
          break;
        case ScenarioType.INVALID_DIMENSION:
          this.state.scenarios.invalidDimension.add(key);
          break;
        case ScenarioType.INTERNAL_ERROR:
          this.state.scenarios.internalError.add(key);
          break;
        case ScenarioType.INSUFFICIENT_BALANCE:
          this.state.scenarios.insufficientBalance.add(key);
          break;
      }
      return res.status(200).json({ ok: true });
    });

    this.app.delete('/hcm/_test/scenario', (req: Request, res: Response) => {
      const { key } = req.body as { key: string };
      this.state.scenarios.timeout.delete(key);
      this.state.scenarios.invalidDimension.delete(key);
      this.state.scenarios.internalError.delete(key);
      this.state.scenarios.insufficientBalance.delete(key);
      this.state.setFailOnCall.delete(key);
      this.state.setCallCount.delete(key);
      return res.status(200).json({ ok: true });
    });

    // Configure a SET call to fail on nth invocation (race condition simulation)
    this.app.post('/hcm/_test/set-fail-on-call', (req: Request, res: Response) => {
      const { key, callIndex } = req.body as { key: string; callIndex: number };
      this.state.setFailOnCall.set(key, callIndex);
      this.state.setCallCount.set(key, 0);
      return res.status(200).json({ ok: true });
    });

    this.app.get('/hcm/_test/call-log', (_req: Request, res: Response) => {
      return res.status(200).json(this.state.callLog);
    });

    this.app.post('/hcm/_test/reset', (_req: Request, res: Response) => {
      this.state = this.freshState();
      return res.status(200).json({ ok: true });
    });
  }

  async start(): Promise<{ url: string }> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, '127.0.0.1', () => {
        const address = this.server.address() as { port: number };
        this._url = `http://127.0.0.1:${address.port}`;
        resolve({ url: this._url });
      });
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // Direct test helpers (no HTTP round-trip needed)
  seed(balance: HcmBalance): void {
    this.state.balances.set(this.balanceKey(balance.employeeId, balance.locationId), balance);
  }

  configureScenario(key: string, type: ScenarioType): void {
    switch (type) {
      case ScenarioType.TIMEOUT:
        this.state.scenarios.timeout.add(key);
        break;
      case ScenarioType.INVALID_DIMENSION:
        this.state.scenarios.invalidDimension.add(key);
        break;
      case ScenarioType.INTERNAL_ERROR:
        this.state.scenarios.internalError.add(key);
        break;
      case ScenarioType.INSUFFICIENT_BALANCE:
        this.state.scenarios.insufficientBalance.add(key);
        break;
    }
  }

  clearScenario(key: string): void {
    this.state.scenarios.timeout.delete(key);
    this.state.scenarios.invalidDimension.delete(key);
    this.state.scenarios.internalError.delete(key);
    this.state.scenarios.insufficientBalance.delete(key);
    this.state.setFailOnCall.delete(key);
    this.state.setCallCount.delete(key);
  }

  configureSetFailOnCall(key: string, callIndex: number): void {
    this.state.setFailOnCall.set(key, callIndex);
    this.state.setCallCount.set(key, 0);
  }

  getCallLog(): HcmCall[] {
    return [...this.state.callLog];
  }

  getBalance(employeeId: string, locationId: string): HcmBalance | undefined {
    return this.state.balances.get(this.balanceKey(employeeId, locationId));
  }

  reset(): void {
    this.state = this.freshState();
  }

  get url(): string {
    return this._url;
  }
}
