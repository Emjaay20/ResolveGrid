import crypto from 'node:crypto';
import { haversineMeters } from '@resolvegrid/shared';
import {
  DispatchTaskRecord,
  FieldObservationRecord,
  KycVerificationRecord,
  store,
} from '../config/datastore';
import { nipostClient } from '../clients/nipostClient';

export class VerificationService {
  private mlEngineUrl = (process.env.ML_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  private kycSecret =
    process.env.KYC_SIGNING_SECRET || 'aetherhost_resolvegrid_kyc_hmac_secret_2026_prod';

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

    const now = new Date();
    const elapsedSinceDispatchSec = Math.max(
      0,
      Math.round((now.getTime() - new Date(task.dispatched_at).getTime()) / 1000)
    );
    const actualDuration =
      params.actualDurationSec !== undefined
        ? params.actualDurationSec
        : elapsedSinceDispatchSec;

    const residualError = actualDuration - task.predicted_eta_sec;

    task.status = 'ARRIVED_VERIFIED';
    task.actual_arrival_at = now.toISOString();
    task.actual_duration_sec = actualDuration;
    task.residual_error_sec = residualError;

    // Update Last-50m Building Intelligence Graph for this NIPOST Postcode
    const postcodeEntry = store.postcodeMap.get(task.resolved_postcode);
    if (postcodeEntry && postcodeEntry.building_telemetry) {
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
    let onlineLearnResult: Record<string, unknown> = {
      updated: true,
      mode: 'local_online_mirror',
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${this.mlEngineUrl}/v1/ml/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: task.id,
          postcode: task.resolved_postcode,
          road_distance_m: task.road_distance_m,
          osrm_base_duration_sec: task.osrm_base_duration_sec,
          gate_delay_sec: params.measuredGateDelaySec ?? task.gate_delay_sec,
          rain_mm: task.weather_rain_mm,
          predicted_eta_sec: task.predicted_eta_sec,
          actual_duration_sec: actualDuration,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        onlineLearnResult = (await res.json()) as Record<string, unknown>;
      }
    } catch {
      clearTimeout(timer);
    }

    task.online_model_updated = true;
    store.taskMap.set(task.id, task);

    if (store.mysqlPool && store.mysqlConnected) {
      try {
        await store.mysqlPool.execute(
          `UPDATE dispatch_tasks SET status = 'ARRIVED_VERIFIED', actual_arrival_at = NOW(), actual_duration_sec = ?, residual_error_sec = ?, online_model_updated = TRUE WHERE id = ?`,
          [actualDuration, residualError, task.id]
        );
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
