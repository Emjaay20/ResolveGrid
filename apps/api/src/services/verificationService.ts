import crypto from 'node:crypto';
import { haversineMeters } from '@resolvegrid/shared';
import {
  DispatchTaskRecord,
  FieldObservationRecord,
  KycVerificationRecord,
  store,
} from '../config/datastore';
import { nipostClient } from '../clients/nipostClient';

export interface MlLearnPayload {
  task_id: string;
  postcode: string;
  road_distance_m: number;
  osrm_base_duration_sec: number;
  gate_delay_sec: number;
  compound_walk_meters: number;
  velocity_kmh: number;
  rolling_1h_on_time_rate: number;
  active_load: number;
  rain_mm: number;
  predicted_eta_sec: number;
  actual_duration_sec: number;
}

interface PendingMlFeedbackItem {
  payload: MlLearnPayload;
  attempts: number;
  status: 'PENDING' | 'DEAD_LETTER';
  nextRetryAtMs: number;
  lastError: string | null;
  queuedAt: string;
}

const MAX_OUTBOX_ATTEMPTS = 20;

export class VerificationService {
  private mlEngineUrl = (process.env.ML_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  private kycSecret = process.env.KYC_SIGNING_SECRET?.trim() || '';
  private pendingMlFeedback = new Map<string, PendingMlFeedbackItem>();
  private outboxSchemaReady = false;
  private outboxTimer: NodeJS.Timeout | null = null;

  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      this.outboxTimer = setInterval(() => {
        void this.flushPendingMlFeedback();
      }, 15000);
      this.outboxTimer.unref();
    }
  }

  public getPendingMlFeedbackCount(): number {
    let count = 0;
    for (const item of this.pendingMlFeedback.values()) {
      if (item.status === 'PENDING') count += 1;
    }
    return count;
  }

  public getDeadLetterCount(): number {
    let count = 0;
    for (const item of this.pendingMlFeedback.values()) {
      if (item.status === 'DEAD_LETTER') count += 1;
    }
    return count;
  }

  public async getOutboxSummary(): Promise<{ pending: number; dead_letter: number; durable_mysql: boolean }> {
    if (store.mysqlPool && store.mysqlConnected) {
      try {
        await this.ensureOutboxSchema();
        const [rows] = await store.mysqlPool.query(
          `SELECT status, COUNT(*) AS cnt FROM ml_learning_outbox WHERE status IN ('PENDING', 'DEAD_LETTER') GROUP BY status`
        );
        let pending = 0;
        let deadLetter = 0;
        for (const row of rows as Array<{ status: string; cnt: number }>) {
          if (row.status === 'PENDING') pending = Number(row.cnt);
          if (row.status === 'DEAD_LETTER') deadLetter = Number(row.cnt);
        }
        return { pending, dead_letter: deadLetter, durable_mysql: true };
      } catch {
        // Fall through to in-memory summary
      }
    }
    return {
      pending: this.getPendingMlFeedbackCount(),
      dead_letter: this.getDeadLetterCount(),
      durable_mysql: false,
    };
  }

  private async ensureOutboxSchema(): Promise<void> {
    if (this.outboxSchemaReady || !store.mysqlPool || !store.mysqlConnected) return;
    await store.mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS ml_learning_outbox (
        task_id VARCHAR(128) PRIMARY KEY,
        payload JSON NOT NULL,
        status ENUM('PENDING', 'COMPLETED', 'DEAD_LETTER') NOT NULL DEFAULT 'PENDING',
        attempts INT NOT NULL DEFAULT 0,
        next_retry_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_error VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ml_outbox_status_retry (status, next_retry_at)
      ) ENGINE=InnoDB
    `);
    this.outboxSchemaReady = true;
  }

  private computeBackoffSec(attempts: number): number {
    return Math.min(300, 5 * Math.pow(2, Math.max(0, attempts - 1)));
  }

  private async enqueueOutbox(payload: MlLearnPayload, errorMsg: string): Promise<void> {
    const nowMs = Date.now();
    const backoffSec = this.computeBackoffSec(1);
    this.pendingMlFeedback.set(payload.task_id, {
      payload,
      attempts: 1,
      status: 'PENDING',
      nextRetryAtMs: nowMs + backoffSec * 1000,
      lastError: errorMsg,
      queuedAt: new Date(nowMs).toISOString(),
    });

    if (store.mysqlPool && store.mysqlConnected) {
      try {
        await this.ensureOutboxSchema();
        await store.mysqlPool.execute(
          `INSERT INTO ml_learning_outbox (task_id, payload, status, attempts, next_retry_at, last_error)
           VALUES (?, ?, 'PENDING', 1, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)
           ON DUPLICATE KEY UPDATE
             payload = VALUES(payload),
             status = 'PENDING',
             attempts = attempts + 1,
             next_retry_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
             last_error = VALUES(last_error)`,
          [payload.task_id, JSON.stringify(payload), backoffSec, errorMsg.slice(0, 250), backoffSec]
        );
      } catch {
        // Keep in-memory mirror if MySQL write fails transiently
      }
    }
  }

  private async sendMlLearnPayload(payload: MlLearnPayload): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${this.mlEngineUrl}/v1/ml/learn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ML-Service-Token': process.env.ML_SERVICE_TOKEN || '',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        return (await res.json()) as Record<string, unknown>;
      }
      return null;
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  private async markLearningCompleted(taskId: string): Promise<void> {
    this.pendingMlFeedback.delete(taskId);
    const task = store.taskMap.get(taskId);
    if (task) {
      task.online_model_updated = true;
      store.taskMap.set(taskId, task);
    }
    if (store.mysqlPool && store.mysqlConnected) {
      try {
        await this.ensureOutboxSchema();
        await store.mysqlPool.execute(
          `UPDATE ml_learning_outbox SET status = 'COMPLETED', last_error = NULL WHERE task_id = ?`,
          [taskId]
        );
        await store.mysqlPool.execute(
          'UPDATE dispatch_tasks SET online_model_updated = ? WHERE id = ?',
          [true, taskId]
        );
      } catch {
        // Ignore transient DB error
      }
    }
  }

  /**
   * Replays queued verified-arrival observations from the durable MySQL outbox
   * (or in-memory mirror when running without MySQL) using exponential backoff
   * and dead-lettering after MAX_OUTBOX_ATTEMPTS.
   */
  public async flushPendingMlFeedback(options?: { ignoreBackoff?: boolean }): Promise<{
    flushed: number;
    remaining: number;
    dead_letter: number;
  }> {
    let flushed = 0;
    const nowMs = Date.now();
    const ignoreBackoff = options?.ignoreBackoff === true;

    if (store.mysqlPool && store.mysqlConnected) {
      try {
        await this.ensureOutboxSchema();
        const dueSql = ignoreBackoff
          ? `SELECT task_id, payload, attempts FROM ml_learning_outbox WHERE status = 'PENDING' ORDER BY next_retry_at ASC LIMIT 50`
          : `SELECT task_id, payload, attempts FROM ml_learning_outbox WHERE status = 'PENDING' AND next_retry_at <= NOW() ORDER BY next_retry_at ASC LIMIT 50`;
        const [rows] = await store.mysqlPool.query(dueSql);
        for (const row of rows as Array<{ task_id: string; payload: string | MlLearnPayload; attempts: number }>) {
          const payload: MlLearnPayload =
            typeof row.payload === 'string' ? (JSON.parse(row.payload) as MlLearnPayload) : row.payload;
          const result = await this.sendMlLearnPayload(payload);
          if (result && (result.updated === true || result.reason === 'duplicate_task')) {
            await this.markLearningCompleted(row.task_id);
            flushed += 1;
          } else {
            const nextAttempts = Number(row.attempts) + 1;
            if (nextAttempts >= MAX_OUTBOX_ATTEMPTS) {
              await store.mysqlPool.execute(
                `UPDATE ml_learning_outbox SET status = 'DEAD_LETTER', attempts = ?, last_error = ? WHERE task_id = ?`,
                [nextAttempts, 'Max retry attempts exceeded', row.task_id]
              );
            } else {
              const backoffSec = this.computeBackoffSec(nextAttempts);
              await store.mysqlPool.execute(
                `UPDATE ml_learning_outbox SET attempts = ?, next_retry_at = DATE_ADD(NOW(), INTERVAL ? SECOND), last_error = ? WHERE task_id = ?`,
                [nextAttempts, backoffSec, 'ML engine unavailable', row.task_id]
              );
            }
          }
        }
      } catch {
        // Fall back to in-memory outbox flush if MySQL is temporarily unavailable
      }
    }

    for (const [taskId, item] of this.pendingMlFeedback.entries()) {
      if (item.status !== 'PENDING') continue;
      if (!ignoreBackoff && item.nextRetryAtMs > nowMs) continue;
      const result = await this.sendMlLearnPayload(item.payload);
      if (result && (result.updated === true || result.reason === 'duplicate_task')) {
        await this.markLearningCompleted(taskId);
        flushed += 1;
      } else {
        item.attempts += 1;
        item.lastError = 'ML engine unavailable';
        if (item.attempts >= MAX_OUTBOX_ATTEMPTS) {
          item.status = 'DEAD_LETTER';
        } else {
          item.nextRetryAtMs = nowMs + this.computeBackoffSec(item.attempts) * 1000;
        }
      }
    }

    return {
      flushed,
      remaining: this.getPendingMlFeedbackCount(),
      dead_letter: this.getDeadLetterCount(),
    };
  }

  /**
   * Records physical ground-truth arrival at the target NIPOST building geofence,
   * computes residual error (Actual - Predicted), updates Last-50m Gate Delay,
   * and triggers the online residual learner in FastAPI.
   */
  public async verifyTaskArrivalAndLearn(params: {
    taskId: string;
    actualDurationSec?: number;
    measuredGateDelaySec?: number;
    buildingAccessNotes?: string;
  }): Promise<{
    task: DispatchTaskRecord;
    online_learning_response: Record<string, unknown>;
  } | null> {
    const task = store.taskMap.get(params.taskId);
    if (!task) return null;
    // If delivery was verified but the ML update failed, allow a safe replay.
    // The Python learner deduplicates task IDs after a successful update.
    const replayPendingLearning = task.status === 'ARRIVED_VERIFIED' && !task.online_model_updated;
    if (task.status === 'ARRIVED_VERIFIED' && !replayPendingLearning) {
      return { task, online_learning_response: { updated: false, reason: 'already_verified' } };
    }

    const now = new Date();
    const elapsedSinceDispatchSec = Math.max(
      0,
      Math.round((now.getTime() - new Date(task.dispatched_at).getTime()) / 1000)
    );
    const actualDuration = replayPendingLearning && task.actual_duration_sec !== null
      ? task.actual_duration_sec
      : params.actualDurationSec !== undefined
        ? params.actualDurationSec
        : elapsedSinceDispatchSec;

    const residualError = actualDuration - task.predicted_eta_sec;

    if (!replayPendingLearning) {
      task.status = 'ARRIVED_VERIFIED';
      task.actual_arrival_at = now.toISOString();
      task.actual_duration_sec = actualDuration;
      task.residual_error_sec = residualError;
    }

    // Update Last-50m Building Intelligence Graph for this NIPOST Postcode
    const postcodeEntry = store.postcodeMap.get(task.resolved_postcode);
    if (!replayPendingLearning && postcodeEntry && postcodeEntry.building_telemetry) {
      const bt = postcodeEntry.building_telemetry;
      if (params.measuredGateDelaySec !== undefined) {
        bt.avg_security_check_delay_sec = Math.round(
          0.75 * bt.avg_security_check_delay_sec + 0.25 * params.measuredGateDelaySec
        );
      }
      if (params.buildingAccessNotes) {
        bt.building_access_notes = params.buildingAccessNotes;
      }
      bt.verified_arrival_count += 1;
      bt.kyc_trust_score = Number(Math.min(99.9, bt.kyc_trust_score + 0.1).toFixed(2));
      store.postcodeMap.set(task.resolved_postcode, postcodeEntry);
    }

    // Trigger the FastAPI online residual learner (POST /v1/ml/learn)
    const assignedAgent = store.agentMap.get(task.assigned_agent_id);
    const mlPayload: MlLearnPayload = {
      task_id: task.id,
      postcode: task.resolved_postcode,
      road_distance_m: task.road_distance_m,
      osrm_base_duration_sec: task.osrm_base_duration_sec,
      gate_delay_sec: params.measuredGateDelaySec ?? task.gate_delay_sec,
      compound_walk_meters: postcodeEntry?.building_telemetry?.compound_walk_meters ?? 25,
      velocity_kmh: assignedAgent?.velocity_kmh ?? 30,
      rolling_1h_on_time_rate: assignedAgent?.rolling_1h_on_time_rate ?? 0.96,
      active_load: assignedAgent?.active_load ?? 0,
      rain_mm: task.weather_rain_mm,
      predicted_eta_sec: task.predicted_eta_sec,
      actual_duration_sec: actualDuration,
    };

    const mlResponse = await this.sendMlLearnPayload(mlPayload);
    let onlineLearnResult: Record<string, unknown>;
    if (mlResponse) {
      onlineLearnResult = mlResponse;
      if (mlResponse.updated === true || mlResponse.reason === 'duplicate_task') {
        await this.markLearningCompleted(task.id);
      }
    } else {
      await this.enqueueOutbox(mlPayload, 'ML engine unavailable');
      onlineLearnResult = {
        updated: false,
        queued_for_retry: true,
        mode: 'model_service_unavailable',
      };
    }

    task.online_model_updated = onlineLearnResult.updated === true || onlineLearnResult.reason === 'duplicate_task';
    store.taskMap.set(task.id, task);

    if (store.mysqlPool && store.mysqlConnected) {
      try {
        if (replayPendingLearning) {
          await store.mysqlPool.execute(
            'UPDATE dispatch_tasks SET online_model_updated = ? WHERE id = ?',
            [task.online_model_updated, task.id]
          );
        } else {
          await store.mysqlPool.execute(
            `UPDATE dispatch_tasks SET status = 'ARRIVED_VERIFIED', actual_arrival_at = NOW(), actual_duration_sec = ?, residual_error_sec = ?, online_model_updated = ? WHERE id = ?`,
            [actualDuration, residualError, task.online_model_updated, task.id]
          );
        }
      } catch {
        // Ignore transient DB error
      }
    }

    return {
      task,
      online_learning_response: onlineLearnResult,
    };
  }

  /**
   * Processes a live hardware GPS ping from the Mobile Field App or transponder stream,
   * and automatically triggers geofence verification if the agent enters within 60m of target building.
   */
  public async processLiveGpsPing(params: {
    agentId: string;
    latitude: number;
    longitude: number;
    velocityKmh?: number;
    headingDeg?: number;
    telemetrySource?: string;
  }): Promise<{
    agent: unknown;
    auto_verified_tasks: DispatchTaskRecord[];
  }> {
    const updatedAgent = await store.updateAgentPosition(
      params.agentId,
      params.latitude,
      params.longitude,
      params.velocityKmh,
      params.headingDeg,
      params.telemetrySource || 'HARDWARE_GPS'
    );

    const autoVerified: DispatchTaskRecord[] = [];
    for (const task of store.taskMap.values()) {
      if (
        task.status === 'DISPATCHED' &&
        task.assigned_agent_id === params.agentId
      ) {
        const dest = store.postcodeMap.get(task.resolved_postcode);
        if (dest?.coordinates) {
          const distToGate = haversineMeters(
            params.latitude,
            params.longitude,
            dest.coordinates.latitude,
            dest.coordinates.longitude
          );
          if (distToGate <= 60) {
            const verified = await this.verifyTaskArrivalAndLearn({ taskId: task.id });
            if (verified) {
              autoVerified.push(verified.task);
            }
          }
        }
      }
    }

    return {
      agent: updatedAgent,
      auto_verified_tasks: autoVerified,
    };
  }

  /**
   * Creates an append-only field observation. Aggregated building intelligence is
   * deliberately not changed here: a reviewer can approve or reject submitted evidence.
   */
  public async submitFieldObservation(params: {
    agentId: string;
    postcode: string;
    latitude: number;
    longitude: number;
    gpsAccuracyM: number;
    gateClearanceRequired: boolean;
    measuredGateDelaySec: number;
    compoundWalkMeters: number;
    buildingAccessNotes?: string;
    overrideNipostKey?: string;
  }): Promise<
    | { accepted: true; observation: FieldObservationRecord; postcode_source: string }
    | { accepted: false; error: string }
  > {
    const isDispatchAgent = store.agentMap.has(params.agentId);
    const isProvisionedFieldAgent = Array.from(store.fieldAgentById.values()).some(
      (account) => account.active && account.agent_id === params.agentId
    );
    if (!isDispatchAgent && !isProvisionedFieldAgent) {
      return {
        accepted: false,
        error: 'Unknown field identity. Sign in with a provisioned field account before submitting observations.',
      };
    }

    const postcode = await nipostClient.lookupPostcode(params.postcode, 3, params.overrideNipostKey);
    if (!postcode) {
      return { accepted: false, error: 'The supplied postcode is invalid or unavailable.' };
    }
    if (postcode.source === 'LOCAL_DEVELOPMENT_FIXTURE') {
      return {
        accepted: false,
        error: 'This postcode resolved only from a local development fixture and cannot receive real field evidence.',
      };
    }

    const observation: FieldObservationRecord = {
      id: `obs_${crypto.randomUUID().slice(0, 12)}`,
      postcode: postcode.postcode,
      agent_id: params.agentId,
      device_lat: params.latitude,
      device_lng: params.longitude,
      gps_accuracy_m: params.gpsAccuracyM,
      gate_clearance_required: params.gateClearanceRequired,
      measured_gate_delay_sec: params.measuredGateDelaySec,
      compound_walk_meters: params.compoundWalkMeters,
      building_access_notes: params.buildingAccessNotes?.trim() || null,
      status: 'SUBMITTED',
      observed_at: new Date().toISOString(),
    };

    await store.saveFieldObservation(observation);
    return { accepted: true, observation, postcode_source: postcode.source };
  }

  /**
   * Generates a Cryptographically Signed KYC Proof-of-Location Postcode Pass
   * using real hardware GPS + NIPOST Reverse Geocode + L3 Building Lookup.
   */
  public async verifyKycLocation(params: {
    applicantRef: string;
    latitude: number;
    longitude: number;
    gpsAccuracyM: number;
    claimedPostcode?: string;
    overrideNipostKey?: string;
  }): Promise<{
    verification: KycVerificationRecord;
    resolved_building: unknown;
    evidence: {
      postcode_source: string;
      official_postcode_match: boolean;
      gps_accuracy_m: number;
    };
  }> {
    const rev = await nipostClient.reverseGeocode(
      params.latitude,
      params.longitude,
      5000,
      params.overrideNipostKey
    );

    const nearestBuilding =
      rev.nearest || Array.from(store.postcodeMap.values())[0];
    const distMeters =
      rev.distance_m >= 0
        ? rev.distance_m
        : nearestBuilding.coordinates
        ? haversineMeters(
            params.latitude,
            params.longitude,
            nearestBuilding.coordinates.latitude,
            nearestBuilding.coordinates.longitude
          )
        : 0;

    const claimed = (params.claimedPostcode || nearestBuilding.postcode)
      .trim()
      .toUpperCase();

    let status: KycVerificationRecord['verification_status'] =
      nearestBuilding.source === 'LOCAL_DEVELOPMENT_FIXTURE'
        ? 'PROXIMITY_WARNING'
        : 'VERIFIED_MATCH';
    if (claimed !== nearestBuilding.postcode && claimed !== nearestBuilding.compact) {
      status = distMeters <= 250 ? 'PROXIMITY_WARNING' : 'MISMATCH_REJECTED';
    } else if (distMeters > 300) {
      status = 'PROXIMITY_WARNING';
    }

    const id = `kyc_${crypto.randomUUID().slice(0, 12)}`;
    const verifiedAt = new Date().toISOString();
    const canonicalPayload = `${id}|${params.applicantRef}|${nearestBuilding.postcode}|${params.latitude.toFixed(
      6
    )}|${params.longitude.toFixed(6)}|${distMeters}|${status}|${verifiedAt}`;

    const hmacSignature = crypto
      .createHmac('sha256', this.kycSecret)
      .update(canonicalPayload)
      .digest('hex');

    const record: KycVerificationRecord = {
      id,
      applicant_ref: params.applicantRef,
      claimed_postcode: claimed,
      reverse_geocoded_postcode: nearestBuilding.postcode,
      device_lat: params.latitude,
      device_lng: params.longitude,
      gps_accuracy_m: params.gpsAccuracyM,
      distance_to_building_m: distMeters,
      building_use_status: nearestBuilding.building_use_status || 'commercial',
      verification_status: status,
      hmac_signature: hmacSignature,
      verified_at: verifiedAt,
    };

    await store.saveKycVerification(record);

    return {
      verification: record,
      resolved_building: nearestBuilding,
      evidence: {
        postcode_source: nearestBuilding.source,
        official_postcode_match: nearestBuilding.source !== 'LOCAL_DEVELOPMENT_FIXTURE',
        gps_accuracy_m: params.gpsAccuracyM,
      },
    };
  }
}

export const verificationService = new VerificationService();
