import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import test from 'node:test';
import assert from 'node:assert/strict';
import { nipostClient } from './clients/nipostClient';
import { store } from './config/datastore';
import { dispatchService } from './services/dispatchService';
import { verificationService } from './services/verificationService';

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
  assert.equal(metrics.key_status, 'SANDBOX_TEST_KEY');
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
