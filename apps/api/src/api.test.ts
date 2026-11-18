import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { app } from './index';
import { nipostClient } from './clients/nipostClient';
import { store } from './config/datastore';
import { dispatchService } from './services/dispatchService';
import { verificationService } from './services/verificationService';
import { taskLifecycleService } from './services/taskLifecycleService';

test('nipostClient resolves deterministic postcode fixtures with L3 attributes', async () => {
  const ekiti = await nipostClient.lookupPostcode('EK-01-A03-FK-01', 3);
  assert.ok(ekiti);
  assert.equal(ekiti.postcode, 'EK-01-A03-FK-01');
  assert.equal(ekiti.legacy_postal_code, '360101');
  assert.equal(ekiti.administrative_address.state_name, 'EKITI');

  const wuse = await nipostClient.lookupPostcode('FC02A09DB09', 3);
  assert.ok(wuse);
  assert.equal(wuse.postcode, 'FC-02-A09-DB-09');
  assert.equal(wuse.legacy_postal_code, '900288');

  const refStates = await nipostClient.getReferenceHierarchy({ state: 'FC' });
  assert.ok(refStates.data);
  const metrics = nipostClient.getMetrics();
  assert.equal(
    metrics.key_status,
    process.env.NIPOST_API_KEY?.startsWith('nipost_test_')
      ? 'SANDBOX_TEST_KEY'
      : 'AWAITING_DASHBOARD_KEY'
  );
  assert.equal(metrics.upstream_failures, 0);
});

test('dispatchService resolves messy Nigerian landmarks and dispatches with idempotency', async () => {
  const resolved = await dispatchService.resolveAddressOrchestrated(
    'Yellow building opposite Central Mosque gate near NNPC station Gimbiya St Area 11 Garki'
  );
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.primary_match.postcode, 'FC-02-A04-GK-11');
  assert.equal(resolved.primary_match.legacy_postal_code, '900241');
  assert.ok(resolved.agent_trace.steps.length >= 3);

  const idemKey = `test_idem_${Date.now()}`;
  const d1 = await dispatchService.dispatchTask({
    idempotencyKey: idemKey,
    tenantId: 'tenant_logistics_ng',
    postcode: 'FC-02-A09-DB-09',
  });
  assert.equal(d1.idempotent_replay, false);
  assert.equal(d1.task.resolved_postcode, 'FC-02-A09-DB-09');

  const d2 = await dispatchService.dispatchTask({
    idempotencyKey: idemKey,
    tenantId: 'tenant_logistics_ng',
    postcode: 'FC-02-A09-DB-09',
  });
  assert.equal(d2.idempotent_replay, true);
  assert.equal(d2.task.id, d1.task.id);

  // Verify ground-truth arrival & online learning loop
  const verified = await verificationService.verifyTaskArrivalAndLearn({
    taskId: d1.task.id,
    actualDurationSec: d1.task.predicted_eta_sec + 9,
  });
  assert.ok(verified);
  assert.equal(verified.task.status, 'ARRIVED_VERIFIED');
  assert.equal(verified.task.residual_error_sec, 9);
  const recordedArrival = verified.task.actual_arrival_at;
  const verifyReplay = await verificationService.verifyTaskArrivalAndLearn({
    taskId: d1.task.id, actualDurationSec: 9999,
  });
  assert.ok(verifyReplay);
  assert.equal(verifyReplay.task.actual_duration_sec, verified.task.actual_duration_sec);
  assert.equal(verifyReplay.task.actual_arrival_at, recordedArrival);
});

test('provisioned field identities pass the field-agent check before source validation', async () => {
  const accountId = 'fa_test_field_identity';
  const agentId = 'field_test_identity';
  store.fieldAgentById.set(accountId, {
    id: accountId,
    agent_id: agentId,
    email: 'field-test@example.com',
    display_name: 'Field Test',
    password_hash: 'not-used-in-this-test',
    active: true,
    created_at: new Date().toISOString(),
    last_login_at: null,
  });

  try {
    const result = await verificationService.submitFieldObservation({
      agentId,
      postcode: 'FC-02-A09-DB-09',
      latitude: 9.07874,
      longitude: 7.47018,
      gpsAccuracyM: 8,
      gateClearanceRequired: false,
      measuredGateDelaySec: 20,
      compoundWalkMeters: 15,
    });

    assert.equal(result.accepted, false);
    if (!result.accepted) assert.match(result.error, /local development fixture/i);
  } finally {
    store.fieldAgentById.delete(accountId);
  }
});

test('public dispatch cannot replay a private workspace task', async (t) => {
  const idempotencyKey = `workspace_scope_${Date.now()}`;
  const dispatched = await dispatchService.dispatchTask({
    idempotencyKey,
    tenantId: 'pilot_workspace_test',
    postcode: 'FC-02-A09-DB-09',
  });

  assert.equal(dispatched.task.tenant_id, 'pilot_workspace_test');
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/v1/tasks/dispatch`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: 'tenant_logistics_ng' }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'This dispatch retry key is unavailable. Use a new key.' });
});

test('a workspace dispatch can be assigned to a named field agent', async () => {
  const dispatched = await dispatchService.dispatchTask({
    idempotencyKey: `field_assignment_${Date.now()}`,
    tenantId: 'pilot_workspace_test',
    postcode: 'FC-02-A09-DB-09',
    assignedFieldAgent: { agentId: 'field_pilot_01', displayName: 'Pilot Field Agent' },
  });

  assert.equal(dispatched.task.assigned_agent_id, 'field_pilot_01');
  assert.equal(dispatched.task.assigned_agent_callsign, 'Pilot Field Agent');
  assert.equal(dispatched.task.status, 'ASSIGNED');

  const accepted = await taskLifecycleService.fieldAction(dispatched.task.id, 'field_pilot_01', 'ACCEPTED');
  assert.equal(accepted.status, 'ACCEPTED');
  const enRoute = await taskLifecycleService.fieldAction(dispatched.task.id, 'field_pilot_01', 'EN_ROUTE');
  assert.equal(enRoute.status, 'EN_ROUTE');
});

test('verificationService queues failed ML feedback and flushes when ML engine recovers', async (t) => {
  const http = await import('node:http');
  const dispatched = await dispatchService.dispatchTask({
    idempotencyKey: `outbox_retry_${Date.now()}`,
    tenantId: 'pilot_workspace_test',
    postcode: 'FC-02-A09-DB-09',
  });

  const svc = verificationService as unknown as {
    mlEngineUrl: string;
    verifyTaskArrivalAndLearn: typeof verificationService.verifyTaskArrivalAndLearn;
    flushPendingMlFeedback: typeof verificationService.flushPendingMlFeedback;
    getPendingMlFeedbackCount: typeof verificationService.getPendingMlFeedbackCount;
  };
  const originalUrl = svc.mlEngineUrl;
  const originalToken = process.env.ML_SERVICE_TOKEN;
  svc.mlEngineUrl = 'http://127.0.0.1:1'; // unreachable port to simulate outage

  try {
    const first = await svc.verifyTaskArrivalAndLearn({
      taskId: dispatched.task.id,
      actualDurationSec: 410,
      measuredGateDelaySec: 35,
    });
    assert.ok(first);
    assert.equal(first.task.online_model_updated, false);
    assert.equal(first.online_learning_response.queued_for_retry, true);
    assert.ok(svc.getPendingMlFeedbackCount() >= 1);

    let receivedToken: string | undefined;
    const mockMl = http.createServer((req, res) => {
      receivedToken = req.headers['x-ml-service-token'] as string | undefined;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ updated: true, task_id: dispatched.task.id }));
    });
    t.after(() => mockMl.close());
    await new Promise<void>((resolve) => mockMl.listen(0, '127.0.0.1', resolve));
    const { port } = mockMl.address() as AddressInfo;

    process.env.ML_SERVICE_TOKEN = 'test-ml-token';
    svc.mlEngineUrl = `http://127.0.0.1:${port}`;
    const flushed = await svc.flushPendingMlFeedback();
    assert.ok(flushed.flushed >= 1);
    assert.equal(flushed.remaining, 0);
    assert.equal(receivedToken, 'test-ml-token');
    assert.equal(store.taskMap.get(dispatched.task.id)?.online_model_updated, true);
  } finally {
    svc.mlEngineUrl = originalUrl;
    if (originalToken === undefined) {
      delete process.env.ML_SERVICE_TOKEN;
    } else {
      process.env.ML_SERVICE_TOKEN = originalToken;
    }
  }
});
