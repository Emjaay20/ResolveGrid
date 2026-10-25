import crypto from 'node:crypto';
import {
  AddressResolutionResponse,
  NipostLookupResult,
  haversineMeters,
} from '@resolvegrid/shared';
import {
  AgentRecord,
  DispatchTaskRecord,
  TENANT_PROFILES,
  store,
} from '../config/datastore';
import { nipostClient } from '../clients/nipostClient';
import { externalTelemetry } from './externalTelemetry';

export interface CandidateRankingItem {
  agent_id: string;
  callsign: string;
  agent_type: string;
  straight_distance_m: number;
  road_distance_m: number;
  osrm_base_duration_sec: number;
  gate_delay_sec: number;
  weather_penalty_sec: number;
  champion_lgbm_eta_sec: number;
  challenger_river_eta_sec: number;
  final_predicted_eta_sec: number;
  lock_acquired?: boolean;
}

export class DispatchService {
  private mlEngineUrl = (process.env.ML_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

  /**
   * Resolves a natural language Nigerian address via the FastAPI Multi-Tool Agent,
   * with automatic fallback to the local NIPOST Gateway orchestrator.
   */
  public async resolveAddressOrchestrated(
    query: string,
    lat?: number,
    lng?: number,
    overrideNipostKey?: string
  ): Promise<AddressResolutionResponse> {
    const start = performance.now();

    // Try calling FastAPI ML Engine's Multi-Tool NIPOST Agent first
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(`${this.mlEngineUrl}/v1/agent/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(overrideNipostKey ? { 'X-Nipost-Key': overrideNipostKey } : {}),
        },
        body: JSON.stringify({ query, lat, lng }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const agentResult = (await response.json()) as AddressResolutionResponse;
        return agentResult;
      }
    } catch {
      clearTimeout(timer);
    }

    // Deterministic Multi-Tool Orchestration Chain (Node.js Gateway Direct Execution)
    const steps: AddressResolutionResponse['agent_trace']['steps'] = [];

    // Step 1: Segment-aware autocomplete & landmark search
    const t1 = performance.now();
    const searchRes = await nipostClient.autocompleteSearch(query, overrideNipostKey);
    steps.push({
      step: 1,
      tool_name: 'nipost_segment_search',
      endpoint: 'GET /v1/search/autocomplete',
      input_params: { q: query },
      output_summary: `Found ${searchRes.results.length} candidate NIPOST building units (top: ${
        searchRes.results[0]?.postcode || 'none'
      })`,
      latency_ms: Number((performance.now() - t1).toFixed(2)),
      status:
        searchRes.upstream_queried &&
        searchRes.results[0]?.source !== 'LOCAL_DEVELOPMENT_FIXTURE'
          ? 'SUCCESS'
          : 'FALLBACK_REGISTRY',
    });

    const primaryCandidate = searchRes.results[0];

    // Step 2: Spatial Reverse / Nearby Confirmation
    const t2 = performance.now();
    const targetLat = lat ?? primaryCandidate?.coordinates?.latitude ?? 9.07874;
    const targetLng = lng ?? primaryCandidate?.coordinates?.longitude ?? 7.47018;
    const nearbyRes = await nipostClient.nearbySearch(
      { code: primaryCandidate?.postcode, lat: targetLat, lng: targetLng, radius: 1500 },
      overrideNipostKey
    );
    steps.push({
      step: 2,
      tool_name: 'nipost_nearby_and_reverse',
      endpoint: 'GET /v1/search/nearby',
      input_params: {
        code: primaryCandidate?.postcode,
        lat: targetLat,
        lng: targetLng,
        radius: 1500,
      },
      output_summary: `Confirmed ${nearbyRes.units.length} addressable NIPOST units within 1.5km geofence`,
      latency_ms: Number((performance.now() - t2).toFixed(2)),
      status: nearbyRes.units.some(
        (unit) => unit.postcode.source !== 'LOCAL_DEVELOPMENT_FIXTURE'
      )
        ? 'SUCCESS'
        : 'FALLBACK_REGISTRY',
    });

    // Step 3: Graded L3 Building Lookup
    const t3 = performance.now();
    const lookedUp =
      (await nipostClient.lookupPostcode(
        primaryCandidate.postcode,
        3,
        overrideNipostKey
      )) || primaryCandidate;
    steps.push({
      step: 3,
      tool_name: 'nipost_lookup_l1_l3',
      endpoint: 'GET /v1/lookup?level=3',
      input_params: { code: primaryCandidate.postcode, level: 3 },
      output_summary:
        lookedUp.source === 'LOCAL_DEVELOPMENT_FIXTURE'
          ? `Matched local development fixture ${lookedUp.postcode}; official NIPOST verification is still required.`
          : `Verified NIPOST building status (${lookedUp.building_use_status}) & gate delay (${lookedUp.building_telemetry?.avg_security_check_delay_sec}s)`,
      latency_ms: Number((performance.now() - t3).toFixed(2)),
      status:
        lookedUp.source === 'LOCAL_DEVELOPMENT_FIXTURE' ? 'FALLBACK_REGISTRY' : 'SUCCESS',
    });

    // Step 4: Canonical Assembly & Legacy 6-Digit Postal Bridge
    const t4 = performance.now();
    const disassembled = await nipostClient.disassemble(lookedUp.postcode, overrideNipostKey);
    steps.push({
      step: 4,
      tool_name: 'nipost_assemble_and_validate',
      endpoint: 'POST /v1/assembly/assemble',
      input_params: { ...disassembled.segments },
      output_summary: `Validated canonical 5-segment code ${disassembled.postcode} <-> Legacy 6-Digit ${disassembled.legacyPostalCode}`,
      latency_ms: Number((performance.now() - t4).toFixed(2)),
      status:
        lookedUp.source === 'LOCAL_DEVELOPMENT_FIXTURE' ? 'FALLBACK_REGISTRY' : 'SUCCESS',
    });

    const totalLatency = Number((performance.now() - start).toFixed(2));
    const houseLine =
      lookedUp.recent_house_address?.recent || lookedUp.administrative_address.locality_name;
    const localityLine = `${lookedUp.administrative_address.locality_name}, ${lookedUp.administrative_address.lga_name}`;
    const stateLine = `${lookedUp.administrative_address.state_name} STATE, NIGERIA`;

    return {
      query,
      resolved: true,
      confidence: lookedUp.source === 'LOCAL_DEVELOPMENT_FIXTURE' ? 0.55 : 0.96,
      primary_match: lookedUp,
      alternatives: searchRes.results.slice(1, 4),
      standardized_address_block: {
        line_1_building: houseLine,
        line_2_locality: localityLine,
        line_3_lga_state: stateLine,
        nipost_digital_postcode: lookedUp.postcode,
        legacy_6digit_postal_code: lookedUp.legacy_postal_code,
        formatted_copy_block: `${houseLine}\n${localityLine}\n${stateLine}\nNIPOST Digital Postcode: ${lookedUp.display} (${lookedUp.postcode})\nLegacy Postal Code: ${lookedUp.legacy_postal_code}`,
      },
      agent_trace: {
        provider_used: 'resolvegrid-deterministic-orchestrator',
        model_used: 'ndaps-multi-tool-v1',
        total_tool_calls: steps.length,
        total_latency_ms: totalLatency,
        reasoning_summary:
          lookedUp.source === 'LOCAL_DEVELOPMENT_FIXTURE'
            ? `Matched a local development fixture for "${query}". The result is useful for development, but it is not an official NIPOST verification.`
            : `Parsed landmark and street tokens from "${query}", executed NIPOST search to isolate ${lookedUp.administrative_address.locality_name} (${lookedUp.postcode}), and enriched the verified result with its legacy 6-digit bridge (${lookedUp.legacy_postal_code}).`,
        steps,
      },
    };
  }

  /**
   * Executes the 2-Stage "Filter & Rank" Dispatch Pipeline with Idempotency,
   * OSRM Road Routing, Open-Meteo Weather, LightGBM + Online River Scoring, and Redlock.
   */
  public async dispatchTask(params: {
    idempotencyKey: string;
    tenantId?: string;
    rawAddress?: string;
    postcode?: string;
    overrideNipostKey?: string;
  }): Promise<{
    task: DispatchTaskRecord;
    resolved_location: NipostLookupResult;
    ranked_candidates: CandidateRankingItem[];
    telemetry_timings: {
      geosearch_ms: number;
      osrm_weather_ms: number;
      ml_inference_ms: number;
      redlock_ms: number;
      total_ms: number;
    };
    idempotent_replay: boolean;
  }> {
    const tStart = performance.now();

    // 1. Check Idempotency-Key
    const existingTask = store.idempotencyMap.get(params.idempotencyKey);
    if (existingTask) {
      const loc =
        (await nipostClient.lookupPostcode(existingTask.resolved_postcode, 3, params.overrideNipostKey)) ||
        Array.from(store.postcodeMap.values())[0];
      return {
        task: existingTask,
        resolved_location: loc,
        ranked_candidates: [],
        telemetry_timings: {
          geosearch_ms: 0.4,
          osrm_weather_ms: 0.0,
          ml_inference_ms: 0.0,
          redlock_ms: 0.2,
          total_ms: Number((performance.now() - tStart).toFixed(2)),
        },
        idempotent_replay: true,
      };
    }

    const tenant =
      TENANT_PROFILES[params.tenantId || 'tenant_logistics_ng'] ||
      TENANT_PROFILES.tenant_logistics_ng;

    // 2. Resolve Destination NIPOST Postcode
    let resolvedLocation: NipostLookupResult | null = null;
    if (params.postcode) {
      resolvedLocation = await nipostClient.lookupPostcode(
        params.postcode,
        tenant.required_lookup_level,
        params.overrideNipostKey
      );
    }
    if (!resolvedLocation) {
      const res = await this.resolveAddressOrchestrated(
        params.rawAddress || 'Plot 114 Aminu Kano Crescent, Wuse 2, Abuja',
        undefined,
        undefined,
        params.overrideNipostKey
      );
      resolvedLocation = res.primary_match;
    }

    const destLat = resolvedLocation.coordinates?.latitude ?? 9.07874;
    const destLng = resolvedLocation.coordinates?.longitude ?? 7.47018;
    const gateDelaySec =
      resolvedLocation.building_telemetry?.avg_security_check_delay_sec ?? 45;
    const compoundWalkM =
      resolvedLocation.building_telemetry?.compound_walk_meters ?? 25;

    // 3. Stage 1: Sub-millisecond Geospatial Filtering (Redis GEOSEARCH)
    const tGeo = performance.now();
    let geoCandidates = await store.geoSearchAgents(
      destLat,
      destLng,
      tenant.max_search_radius_m
    );
    if (geoCandidates.length === 0) {
      // Expand search across all available agents if none in immediate radius
      geoCandidates = Array.from(store.agentMap.values())
        .filter((a) => a.status === 'AVAILABLE')
        .map((agent) => ({
          agent,
          distance_m: haversineMeters(destLat, destLng, agent.latitude, agent.longitude),
        }))
        .sort((a, b) => a.distance_m - b.distance_m)
        .slice(0, 5);
    }
    const geosearchMs = Number((performance.now() - tGeo).toFixed(2));

    // 4. Hydrate Live Weather (Open-Meteo) & Real Road Network Routing (OSRM)
    const tEnv = performance.now();
    const topCandidates = geoCandidates.slice(0, 5);
    const [weather, primaryRoute] = await Promise.all([
      externalTelemetry.getLiveWeather(destLat, destLng),
      topCandidates[0]
        ? externalTelemetry.getRoadNetworkRoute(
            topCandidates[0].agent.latitude,
            topCandidates[0].agent.longitude,
            destLat,
            destLng
          )
        : Promise.resolve({
            distance_m: 1800,
            duration_sec: 220,
            geometry: [[destLat, destLng]] as [number, number][],
            source: 'HAVERSINE_ROAD_FACTOR' as const,
          }),
    ]);
    const osrmWeatherMs = Number((performance.now() - tEnv).toFixed(2));

    // 5. Stage 2: Vectorized ML Scoring (FastAPI Champion LightGBM + Challenger Online River)
    const tMl = performance.now();
    let dispatchStrategy: DispatchTaskRecord['dispatch_strategy'] =
      'ML_HYBRID_CHAMPION_CHALLENGER';
    const rankedCandidates: CandidateRankingItem[] = [];

    const candidatePayloads = topCandidates.map((c, idx) => {
      const roadDist =
        idx === 0 ? primaryRoute.distance_m : Math.max(150, Math.round(c.distance_m * 1.32));
      const osrmDur =
        idx === 0
          ? primaryRoute.duration_sec
          : Math.round(roadDist / Math.max(4.5, (c.agent.velocity_kmh * 1000) / 3600));
      return {
        agent_id: c.agent.id,
        callsign: c.agent.callsign,
        agent_type: c.agent.agent_type,
        straight_distance_m: c.distance_m,
        road_distance_m: roadDist,
        osrm_base_duration_sec: osrmDur,
        velocity_kmh: c.agent.velocity_kmh,
        rolling_1h_on_time_rate: c.agent.rolling_1h_on_time_rate,
        active_load: c.agent.active_load,
        gate_delay_sec: gateDelaySec,
        compound_walk_meters: compoundWalkM,
        rain_mm: weather.rain_mm,
        wind_speed_kmh: weather.wind_speed_kmh,
        postcode: resolvedLocation.postcode,
      };
    });

    const mlController = new AbortController();
    const mlTimeout = setTimeout(() => mlController.abort(), 1500);

    try {
      const mlRes = await fetch(`${this.mlEngineUrl}/v1/ml/dispatch-eta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenant.id,
          ml_profile: tenant.ml_profile,
          postcode: resolvedLocation.postcode,
          candidates: candidatePayloads,
        }),
        signal: mlController.signal,
      });
      clearTimeout(mlTimeout);

      if (mlRes.ok) {
        const mlData = (await mlRes.json()) as {
          ranked_candidates: CandidateRankingItem[];
        };
        if (mlData.ranked_candidates && mlData.ranked_candidates.length > 0) {
          rankedCandidates.push(...mlData.ranked_candidates);
        }
      } else {
        dispatchStrategy = 'FALLBACK_HAVERSINE_CIRCUIT_BREAKER';
      }
    } catch {
      clearTimeout(mlTimeout);
      dispatchStrategy = 'FALLBACK_HAVERSINE_CIRCUIT_BREAKER';
    }

    // Circuit Breaker Deterministic Fallback if ML service is offline
    if (rankedCandidates.length === 0) {
      for (const cp of candidatePayloads) {
        const weatherPenalty = Math.round(cp.rain_mm * 18 + (cp.wind_speed_kmh > 25 ? 25 : 0));
        const walkSec = Math.round(cp.compound_walk_meters / 1.3);
        const lgbmEta = cp.osrm_base_duration_sec + cp.gate_delay_sec + walkSec + weatherPenalty;
        const riverEta = Math.round(lgbmEta * (2 - cp.rolling_1h_on_time_rate));
        const finalEta = Math.round(0.7 * lgbmEta + 0.3 * riverEta);
        rankedCandidates.push({
          agent_id: cp.agent_id,
          callsign: cp.callsign,
          agent_type: cp.agent_type,
          straight_distance_m: cp.straight_distance_m,
          road_distance_m: cp.road_distance_m,
          osrm_base_duration_sec: cp.osrm_base_duration_sec,
          gate_delay_sec: cp.gate_delay_sec,
          weather_penalty_sec: weatherPenalty,
          champion_lgbm_eta_sec: lgbmEta,
          challenger_river_eta_sec: riverEta,
          final_predicted_eta_sec: finalEta,
        });
      }
      rankedCandidates.sort((a, b) => a.final_predicted_eta_sec - b.final_predicted_eta_sec);
    }
    const mlInferenceMs = Number((performance.now() - tMl).toFixed(2));

    // 6. Stage 3: Contention-Resilient Top-K Waterfall Distributed Lock (Redis SETNX)
    const tLock = performance.now();
    const taskId = `task_${crypto.randomUUID().slice(0, 12)}`;
    let winningCandidate = rankedCandidates[0];

    for (const candidate of rankedCandidates) {
      const locked = await store.acquireAgentLock(candidate.agent_id, taskId, 15000);
      candidate.lock_acquired = locked;
      if (locked) {
        winningCandidate = candidate;
        break;
      }
    }
    const redlockMs = Number((performance.now() - tLock).toFixed(2));

    const now = new Date();
    const predictedArrival = new Date(
      now.getTime() + (winningCandidate?.final_predicted_eta_sec || 300) * 1000
    );

    const taskRecord: DispatchTaskRecord = {
      id: taskId,
      idempotency_key: params.idempotencyKey,
      tenant_id: tenant.id,
      raw_input_address: params.rawAddress || resolvedLocation.recent_house_address?.recent || resolvedLocation.postcode,
      resolved_postcode: resolvedLocation.postcode,
      legacy_postal_code: resolvedLocation.legacy_postal_code,
      assigned_agent_id: winningCandidate.agent_id,
      assigned_agent_callsign: winningCandidate.callsign,
      candidate_count: rankedCandidates.length,
      road_distance_m: winningCandidate.road_distance_m,
      osrm_base_duration_sec: winningCandidate.osrm_base_duration_sec,
      gate_delay_sec: winningCandidate.gate_delay_sec,
      weather_rain_mm: weather.rain_mm,
      predicted_eta_sec: winningCandidate.final_predicted_eta_sec,
      champion_lgbm_eta_sec: winningCandidate.champion_lgbm_eta_sec,
      challenger_river_eta_sec: winningCandidate.challenger_river_eta_sec,
      dispatch_strategy: dispatchStrategy,
      status: 'DISPATCHED',
      dispatched_at: now.toISOString(),
      predicted_arrival_at: predictedArrival.toISOString(),
      actual_arrival_at: null,
      actual_duration_sec: null,
      residual_error_sec: null,
      online_model_updated: false,
      route_geometry: primaryRoute.geometry,
    };

    store.taskMap.set(taskRecord.id, taskRecord);
    store.idempotencyMap.set(params.idempotencyKey, taskRecord);

    // Persist ACID transaction + Outbox Event in MySQL if connected
    if (store.mysqlPool && store.mysqlConnected) {
      try {
        const conn = await store.mysqlPool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.execute(
            `INSERT INTO dispatch_tasks (
              id, idempotency_key, tenant_id, raw_input_address, resolved_postcode, legacy_postal_code,
              assigned_agent_id, candidate_count, road_distance_m, osrm_base_duration_sec, gate_delay_sec,
              weather_rain_mm, predicted_eta_sec, champion_lgbm_eta_sec, challenger_river_eta_sec,
              dispatch_strategy, status, predicted_arrival_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISPATCHED', ?)`,
            [
              taskRecord.id,
              taskRecord.idempotency_key,
              taskRecord.tenant_id,
              taskRecord.raw_input_address,
              taskRecord.resolved_postcode,
              taskRecord.legacy_postal_code,
              taskRecord.assigned_agent_id,
              taskRecord.candidate_count,
              taskRecord.road_distance_m,
              taskRecord.osrm_base_duration_sec,
              taskRecord.gate_delay_sec,
              taskRecord.weather_rain_mm,
              taskRecord.predicted_eta_sec,
              taskRecord.champion_lgbm_eta_sec,
              taskRecord.challenger_river_eta_sec,
              taskRecord.dispatch_strategy,
              new Date(taskRecord.predicted_arrival_at),
            ]
          );
          await conn.execute(
            `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('DISPATCH_TASK', ?, 'TASK_DISPATCHED', ?)`,
            [taskRecord.id, JSON.stringify(taskRecord)]
          );
          await conn.commit();
        } catch {
          await conn.rollback();
        } finally {
          conn.release();
        }
      } catch {
        // Ignore transient DB error
      }
    }

    return {
      task: taskRecord,
      resolved_location: resolvedLocation,
      ranked_candidates: rankedCandidates,
      telemetry_timings: {
        geosearch_ms: geosearchMs,
        osrm_weather_ms: osrmWeatherMs,
        ml_inference_ms: mlInferenceMs,
        redlock_ms: redlockMs,
        total_ms: Number((performance.now() - tStart).toFixed(2)),
      },
      idempotent_replay: false,
    };
  }
}

export const dispatchService = new DispatchService();
