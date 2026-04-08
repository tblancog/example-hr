import { HcmMockServer } from './hcm-mock.server';
import { HcmBalance, HcmCall } from '../types';
import { ScenarioType } from '../../src/common/enums';

/** Seed a balance directly into the mock (no HTTP call) */
export function seedBalance(mock: HcmMockServer, balance: HcmBalance): void {
  mock.seed(balance);
}

/** Configure a timeout scenario for the given employee+location key */
export function configureTimeout(mock: HcmMockServer, employeeId: string, locationId: string): void {
  mock.configureScenario(`${employeeId}:${locationId}`, ScenarioType.TIMEOUT);
}

/** Configure an invalid dimension error for the given employee+location key */
export function configureInvalidDimension(mock: HcmMockServer, employeeId: string, locationId: string): void {
  mock.configureScenario(`${employeeId}:${locationId}`, ScenarioType.INVALID_DIMENSION);
}

/** Configure an internal error scenario */
export function configureInternalError(mock: HcmMockServer, employeeId: string, locationId: string): void {
  mock.configureScenario(`${employeeId}:${locationId}`, ScenarioType.INTERNAL_ERROR);
}

/** Configure a forced insufficient balance error on SET */
export function configureInsufficientBalance(mock: HcmMockServer, employeeId: string, locationId: string): void {
  mock.configureScenario(`${employeeId}:${locationId}`, ScenarioType.INSUFFICIENT_BALANCE);
}

/** Clear all scenarios for the given key */
export function clearScenario(mock: HcmMockServer, employeeId: string, locationId: string): void {
  mock.clearScenario(`${employeeId}:${locationId}`);
}

/**
 * Configure the nth SET call for a key to fail with insufficient_balance.
 * Used to simulate a race condition where two approvals compete.
 * callIndex=2 means the 2nd SET call will fail.
 */
export function configureSetRaceFail(mock: HcmMockServer, employeeId: string, locationId: string, callIndex: number): void {
  mock.configureSetFailOnCall(`${employeeId}:${locationId}`, callIndex);
}

/** Return only the SET calls from the call log */
export function getSetCalls(mock: HcmMockServer): HcmCall[] {
  return mock.getCallLog().filter((c) => c.method === 'SET');
}

/** Return only the GET calls (balance reads) from the call log */
export function getGetCalls(mock: HcmMockServer): HcmCall[] {
  return mock.getCallLog().filter((c) => c.method === 'GET');
}

/** Assert the mock received exactly N HCM API calls (GET + SET, not TEST or BATCH) */
export function assertCallCount(mock: HcmMockServer, expected: number): void {
  const apiCalls = mock.getCallLog().filter((c) => c.method === 'GET' || c.method === 'SET');
  if (apiCalls.length !== expected) {
    throw new Error(
      `Expected ${expected} HCM API calls, got ${apiCalls.length}:\n${JSON.stringify(apiCalls, null, 2)}`,
    );
  }
}
