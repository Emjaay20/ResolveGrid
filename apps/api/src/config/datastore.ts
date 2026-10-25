import mysql from 'mysql2/promise';
import Redis from 'ioredis';
import {
  NipostLookupResult,
  BuildingUseStatus,
  haversineMeters,
  latLngToHexCell,
} from '@resolvegrid/shared';

export interface AgentRecord {
  id: string;
  callsign: string;
  agent_type: 'COURIER_BIKE' | 'DISPATCH_VAN' | 'KYC_FIELD_OFFICER' | 'EMERGENCY_UNIT' | 'AIR_TRANSPONDER';
  city: string;
  latitude: number;
  longitude: number;
  h3_res8: string;
  velocity_kmh: number;
  heading_deg: number;
  capacity_units: number;
  active_load: number;
  skill_tags: string[];
  rolling_1h_on_time_rate: number;
  status: 'AVAILABLE' | 'BUSY' | 'OFFLINE';
  telemetry_source: string;
  last_ping_at: string;
}

export interface DispatchTaskRecord {
  id: string;
  idempotency_key: string;
  tenant_id: string;
  raw_input_address: string;
  resolved_postcode: string;
  legacy_postal_code: string;
  assigned_agent_id: string;
  assigned_agent_callsign: string;
  candidate_count: number;
  road_distance_m: number;
  osrm_base_duration_sec: number;
  gate_delay_sec: number;
  weather_rain_mm: number;
  predicted_eta_sec: number;
  champion_lgbm_eta_sec: number;
  challenger_river_eta_sec: number;
  dispatch_strategy: 'ML_HYBRID_CHAMPION_CHALLENGER' | 'FALLBACK_HAVERSINE_CIRCUIT_BREAKER';
  status: 'DISPATCHED' | 'EN_ROUTE' | 'ARRIVED_VERIFIED' | 'CANCELLED';
  dispatched_at: string;
  predicted_arrival_at: string;
  actual_arrival_at: string | null;
  actual_duration_sec: number | null;
  residual_error_sec: number | null;
  online_model_updated: boolean;
  route_geometry?: [number, number][];
}

export interface KycVerificationRecord {
  id: string;
  applicant_ref: string;
  claimed_postcode: string;
  reverse_geocoded_postcode: string;
  device_lat: number;
  device_lng: number;
  gps_accuracy_m: number;
  distance_to_building_m: number;
  building_use_status: string;
  verification_status: 'VERIFIED_MATCH' | 'PROXIMITY_WARNING' | 'MISMATCH_REJECTED';
  hmac_signature: string;
  verified_at: string;
}

export interface FieldObservationRecord {
  id: string;
  postcode: string;
  agent_id: string;
  device_lat: number;
  device_lng: number;
  gps_accuracy_m: number;
  gate_clearance_required: boolean;
  measured_gate_delay_sec: number;
  compound_walk_meters: number;
  building_access_notes: string | null;
  status: 'SUBMITTED';
  observed_at: string;
}

export interface FieldAgentAccount {
  id: string;
  agent_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface TenantProfile {
  id: string;
  name: string;
  industry_vertical: 'LOGISTICS' | 'BANKING_KYC' | 'EMERGENCY_RESPONSE' | 'FIELD_OPS';
  max_search_radius_m: number;
  required_lookup_level: number;
  sla_target_sec: number;
  ml_profile: string;
}

export const INITIAL_POSTCODE_REGISTRY: NipostLookupResult[] = [
  {
    postcode: 'FC-02-A09-DB-09',
    compact: 'FC02A09DB09',
    display: 'FC 02 A09 DB 09',
    valid: true,
    legacy_postal_code: '900288',
    administrative_address: {
      state_code: 'FC',
      state_name: 'FCT ABUJA',
      lga_code: '02',
      lga_name: 'ABUJA MUNICIPAL AREA COUNCIL',
      district_code: 'A09',
      locality_name: 'WUSE II',
      zone: 'NORTH CENTRAL',
    },
    recent_house_address: {
      recent: 'PLOT 114 AMINU KANO CRESCENT, WUSE II, ABUJA',
      landmark_notes: 'YELLOW DUPLEX OPPOSITE AP FILLING STATION NEAR BANEX JUNCTION, WUSE 2',
    },
    building_use_status: 'commercial',
    coordinates: {
      latitude: 9.07874,
      longitude: 7.47018,
      h3_res8: '8858194ad3fffff',
      h3_res10: '8a58194ad307fff',
    },
    building_telemetry: {
      gate_clearance_required: false,
      avg_security_check_delay_sec: 35,
      compound_walk_meters: 20,
      building_access_notes:
        'Direct street entry off Aminu Kano Crescent; rider parking bay in front of yellow duplex security post.',
      verified_arrival_count: 48,
      kyc_trust_score: 97.4,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
  {
    postcode: 'FC-02-A09-DB-14',
    compact: 'FC02A09DB14',
    display: 'FC 02 A09 DB 14',
    valid: true,
    legacy_postal_code: '900288',
    administrative_address: {
      state_code: 'FC',
      state_name: 'FCT ABUJA',
      lga_code: '02',
      lga_name: 'ABUJA MUNICIPAL AREA COUNCIL',
      district_code: 'A09',
      locality_name: 'WUSE II',
      zone: 'NORTH CENTRAL',
    },
    recent_house_address: {
      recent: '24 ADEMOLA ADETOKUNBO CRESCENT, WUSE II, ABUJA',
      landmark_notes: 'BESIDE H-MEDIX PHARMACY & SUPERMARKET, OPPOSITE TRANSCORP HILTON AXIS',
    },
    building_use_status: 'commercial',
    coordinates: {
      latitude: 9.07421,
      longitude: 7.48462,
      h3_res8: '8858194ad1fffff',
      h3_res10: '8a58194ad117fff',
    },
    building_telemetry: {
      gate_clearance_required: false,
      avg_security_check_delay_sec: 45,
      compound_walk_meters: 30,
      building_access_notes:
        'High pedestrian traffic beside H-Medix; use service lane entrance for instant courier drop-off.',
      verified_arrival_count: 63,
      kyc_trust_score: 98.1,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
  {
    postcode: 'FC-02-A04-GK-11',
    compact: 'FC02A04GK11',
    display: 'FC 02 A04 GK 11',
    valid: true,
    legacy_postal_code: '900241',
    administrative_address: {
      state_code: 'FC',
      state_name: 'FCT ABUJA',
      lga_code: '02',
      lga_name: 'ABUJA MUNICIPAL AREA COUNCIL',
      district_code: 'A04',
      locality_name: 'GARKI AREA 11',
      zone: 'NORTH CENTRAL',
    },
    recent_house_address: {
      recent: '18 GIMBIYA STREET, GARKI AREA 11, ABUJA',
      landmark_notes:
        'YELLOW BUILDING OPPOSITE CENTRAL MOSQUE GATE / NEAR NNPC FILLING STATION, AREA 11',
    },
    building_use_status: 'commercial',
    coordinates: {
      latitude: 9.03845,
      longitude: 7.50112,
      h3_res8: '8858194a97fffff',
      h3_res10: '8a58194a9747fff',
    },
    building_telemetry: {
      gate_clearance_required: true,
      avg_security_check_delay_sec: 95,
      compound_walk_meters: 45,
      building_access_notes:
        'Security check at Gimbiya Street compound gate; call recipient for visitor tally token.',
      verified_arrival_count: 34,
      kyc_trust_score: 94.8,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 5,
  },
  {
    postcode: 'FC-02-A07-MT-03',
    compact: 'FC02A07MT03',
    display: 'FC 02 A07 MT 03',
    valid: true,
    legacy_postal_code: '900271',
    administrative_address: {
      state_code: 'FC',
      state_name: 'FCT ABUJA',
      lga_code: '02',
      lga_name: 'ABUJA MUNICIPAL AREA COUNCIL',
      district_code: 'A07',
      locality_name: 'MAITAMA',
      zone: 'NORTH CENTRAL',
    },
    recent_house_address: {
      recent: '9 GANA STREET, MAITAMA DISTRICT, ABUJA',
      landmark_notes:
        'NEAR FARMERS MARKET MAITAMA & NIGERIAN COMMUNICATIONS COMMISSION (NCC) ANNEX',
    },
    building_use_status: 'residential',
    coordinates: {
      latitude: 9.0882,
      longitude: 7.4934,
      h3_res8: '8858194ac3fffff',
      h3_res10: '8a58194ac32ffff',
    },
    building_telemetry: {
      gate_clearance_required: true,
      avg_security_check_delay_sec: 145,
      compound_walk_meters: 65,
      building_access_notes:
        'Gated Maitama diplomatic enclave; commercial riders sign logbook at Gate 1 off Gana Street.',
      verified_arrival_count: 29,
      kyc_trust_score: 96.5,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
  {
    postcode: 'FC-02-B12-JB-21',
    compact: 'FC02B12JB21',
    display: 'FC 02 B12 JB 21',
    valid: true,
    legacy_postal_code: '900108',
    administrative_address: {
      state_code: 'FC',
      state_name: 'FCT ABUJA',
      lga_code: '02',
      lga_name: 'ABUJA MUNICIPAL AREA COUNCIL',
      district_code: 'B12',
      locality_name: 'JABI',
      zone: 'NORTH CENTRAL',
    },
    recent_house_address: {
      recent: 'PLOT 402 BALA SOKOTO WAY, JABI LAKE AXIS, ABUJA',
      landmark_notes: 'OPPOSITE JABI LAKE MALL MAIN GATE, BESIDE SHOPRITE WATERFRONT',
    },
    building_use_status: 'commercial',
    coordinates: {
      latitude: 9.0641,
      longitude: 7.4268,
      h3_res8: '8858194f37fffff',
      h3_res10: '8a58194f371ffff',
    },
    building_telemetry: {
      gate_clearance_required: true,
      avg_security_check_delay_sec: 110,
      compound_walk_meters: 80,
      building_access_notes:
        'Jabi Lake commercial complex; dispatch bikes park at North Gate delivery bay.',
      verified_arrival_count: 52,
      kyc_trust_score: 95.9,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
  {
    postcode: 'LA-08-C01-LK-04',
    compact: 'LA08C01LK04',
    display: 'LA 08 C01 LK 04',
    valid: true,
    legacy_postal_code: '106104',
    administrative_address: {
      state_code: 'LA',
      state_name: 'LAGOS',
      lga_code: '08',
      lga_name: 'ETI-OSA',
      district_code: 'C01',
      locality_name: 'LEKKI PHASE 1',
      zone: 'SOUTH WEST',
    },
    recent_house_address: {
      recent: '14B ADMIRALTY WAY, LEKKI PHASE 1, LAGOS',
      landmark_notes: 'OPPOSITE EBEANO SUPERMARKET, NEAR LEKKI-IKOYI LINK BRIDGE ROUNDABOUT',
    },
    building_use_status: 'commercial',
    coordinates: {
      latitude: 6.4478,
      longitude: 3.4723,
      h3_res8: '885886369bfffff',
      h3_res10: '8a5886369b07fff',
    },
    building_telemetry: {
      gate_clearance_required: true,
      avg_security_check_delay_sec: 160,
      compound_walk_meters: 70,
      building_access_notes:
        'Lekki Phase 1 estate gate clearance required; show Waybill / ResolveGrid Pass at Admiralty Way checkpoint.',
      verified_arrival_count: 87,
      kyc_trust_score: 98.6,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
  {
    postcode: 'LA-08-A02-VI-19',
    compact: 'LA08A02VI19',
    display: 'LA 08 A02 VI 19',
    valid: true,
    legacy_postal_code: '101241',
    administrative_address: {
      state_code: 'LA',
      state_name: 'LAGOS',
      lga_code: '08',
      lga_name: 'ETI-OSA',
      district_code: 'A02',
      locality_name: 'VICTORIA ISLAND',
      zone: 'SOUTH WEST',
    },
    recent_house_address: {
      recent: '290 AKIN ADESOLA STREET, VICTORIA ISLAND, LAGOS',
      landmark_notes: 'BESIDE ZENITH BANK HEADQUARTERS, OFF ADEOLA ODEKU JUNCTION',
    },
    building_use_status: 'commercial',
    coordinates: {
      latitude: 6.4312,
      longitude: 3.4245,
      h3_res8: '88588636d7fffff',
      h3_res10: '8a588636d727fff',
    },
    building_telemetry: {
      gate_clearance_required: true,
      avg_security_check_delay_sec: 120,
      compound_walk_meters: 55,
      building_access_notes:
        'Corporate tower security desk on ground floor; drop packages with mailroom officer.',
      verified_arrival_count: 74,
      kyc_trust_score: 99.1,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
  {
    postcode: 'LA-11-B05-IK-08',
    compact: 'LA11B05IK08',
    display: 'LA 11 B05 IK 08',
    valid: true,
    legacy_postal_code: '100271',
    administrative_address: {
      state_code: 'LA',
      state_name: 'LAGOS',
      lga_code: '11',
      lga_name: 'IKEJA',
      district_code: 'B05',
      locality_name: 'IKEJA GRA',
      zone: 'SOUTH WEST',
    },
    recent_house_address: {
      recent: '42 ISAAC JOHN STREET, IKEJA GRA, LAGOS',
      landmark_notes: 'OPPOSITE RADISSON BLU HOTEL, NEAR JOEL OGUNNAIKE INTERSECTION',
    },
    building_use_status: 'residential',
    coordinates: {
      latitude: 6.5819,
      longitude: 3.3568,
      h3_res8: '8858862343fffff',
      h3_res10: '8a588623430ffff',
    },
    building_telemetry: {
      gate_clearance_required: true,
      avg_security_check_delay_sec: 135,
      compound_walk_meters: 60,
      building_access_notes:
        'Ikeja GRA gated close; obtain access pass from estate security house opposite Radisson Blu.',
      verified_arrival_count: 41,
      kyc_trust_score: 96.2,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
  {
    postcode: 'LA-19-D03-YB-12',
    compact: 'LA19D03YB12',
    display: 'LA 19 D03 YB 12',
    valid: true,
    legacy_postal_code: '101212',
    administrative_address: {
      state_code: 'LA',
      state_name: 'LAGOS',
      lga_code: '19',
      lga_name: 'LAGOS MAINLAND',
      district_code: 'D03',
      locality_name: 'YABA',
      zone: 'SOUTH WEST',
    },
    recent_house_address: {
      recent: '294 HERBERT MACAULAY WAY, SABO YABA, LAGOS',
      landmark_notes: 'NEAR SABO BUS STOP & CC-HUB TECH ZONE, OPPOSITE FIRST BANK SABO',
    },
    building_use_status: 'commercial',
    coordinates: {
      latitude: 6.5095,
      longitude: 3.3782,
      h3_res8: '88588621b7fffff',
      h3_res10: '8a588621b717fff',
    },
    building_telemetry: {
      gate_clearance_required: false,
      avg_security_check_delay_sec: 30,
      compound_walk_meters: 15,
      building_access_notes:
        'Direct storefront access on Herbert Macaulay Way; zero estate gate delay.',
      verified_arrival_count: 92,
      kyc_trust_score: 97.8,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
  {
    postcode: 'EK-01-A03-FK-01',
    compact: 'EK01A03FK01',
    display: 'EK 01 A03 FK 01',
    valid: true,
    legacy_postal_code: '360101',
    administrative_address: {
      state_code: 'EK',
      state_name: 'EKITI',
      lga_code: '01',
      lga_name: 'ADO EKITI',
      district_code: 'A03',
      locality_name: 'ADO EKITI',
      zone: 'SOUTH WEST',
    },
    recent_house_address: {
      recent: 'NTA ROAD, BACK OF FABIAN HOTEL, ADO EKITI',
      landmark_notes: 'BEHIND FABIAN HOTEL OFF NTA ROAD, BASIRI AXIS, ADO EKITI',
    },
    building_use_status: 'residential',
    coordinates: {
      latitude: 7.6211,
      longitude: 5.2215,
      h3_res8: '8858809647fffff',
      h3_res10: '8a5880964707fff',
    },
    building_telemetry: {
      gate_clearance_required: false,
      avg_security_check_delay_sec: 40,
      compound_walk_meters: 25,
      building_access_notes:
        'Access via untarred link road directly behind Fabian Hotel off NTA Road.',
      verified_arrival_count: 19,
      kyc_trust_score: 93.4,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
  {
    postcode: 'RV-16-A01-PH-07',
    compact: 'RV16A01PH07',
    display: 'RV 16 A01 PH 07',
    valid: true,
    legacy_postal_code: '500272',
    administrative_address: {
      state_code: 'RV',
      state_name: 'RIVERS',
      lga_code: '16',
      lga_name: 'PORT HARCOURT',
      district_code: 'A01',
      locality_name: 'NEW GRA PHASE 2',
      zone: 'SOUTH SOUTH',
    },
    recent_house_address: {
      recent: '58 TOMBIA STREET, NEW GRA PHASE 2, PORT HARCOURT',
      landmark_notes: 'OPPOSITE KILIMANJARO FAST FOOD, NEAR POLO CLUB GATE',
    },
    building_use_status: 'commercial',
    coordinates: {
      latitude: 4.8196,
      longitude: 7.0045,
      h3_res8: '8858a4b523fffff',
      h3_res10: '8a58a4b5231ffff',
    },
    building_telemetry: {
      gate_clearance_required: true,
      avg_security_check_delay_sec: 85,
      compound_walk_meters: 40,
      building_access_notes: 'New GRA compound gate; security intercom verification required.',
      verified_arrival_count: 27,
      kyc_trust_score: 95.1,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
  {
    postcode: 'KN-21-A02-NS-05',
    compact: 'KN21A02NS05',
    display: 'KN 21 A02 NS 05',
    valid: true,
    legacy_postal_code: '700213',
    administrative_address: {
      state_code: 'KN',
      state_name: 'KANO',
      lga_code: '21',
      lga_name: 'NASSARAWA',
      district_code: 'A02',
      locality_name: 'NASSARAWA GRA',
      zone: 'NORTH WEST',
    },
    recent_house_address: {
      recent: '15 AUDU BAKO WAY, NASSARAWA GRA, KANO',
      landmark_notes: 'BESIDE TAHIR GUEST PALACE ANNEX, NEAR STATE ROAD JUNCTION',
    },
    building_use_status: 'commercial',
    coordinates: {
      latitude: 11.9964,
      longitude: 8.5462,
      h3_res8: '885832c91bfffff',
      h3_res10: '8a5832c91b07fff',
    },
    building_telemetry: {
      gate_clearance_required: true,
      avg_security_check_delay_sec: 75,
      compound_walk_meters: 35,
      building_access_notes: 'Nassarawa GRA walled complex; use main service gate on Audu Bako Way.',
      verified_arrival_count: 22,
      kyc_trust_score: 94.7,
    },
    source: 'NIPOST_API_SANDBOX',
    cached: false,
    latency_ms: 4,
  },
];

export const INITIAL_AGENTS: AgentRecord[] = [
  {
    id: 'agent_abj_01',
    callsign: 'ABJ-RIDER-104 (Musa I.)',
    agent_type: 'COURIER_BIKE',
    city: 'ABUJA',
    latitude: 9.0761,
    longitude: 7.4759,
    h3_res8: latLngToHexCell(9.0761, 7.4759, 8),
    velocity_kmh: 34.2,
    heading_deg: 115,
    capacity_units: 4,
    active_load: 1,
    skill_tags: ['EXPRESS_BOX', 'COLD_CHAIN', 'KYC_VERIFIED'],
    rolling_1h_on_time_rate: 0.982,
    status: 'AVAILABLE',
    telemetry_source: 'HARDWARE_GPS',
    last_ping_at: new Date().toISOString(),
  },
  {
    id: 'agent_abj_02',
    callsign: 'ABJ-RIDER-218 (Chinedu O.)',
    agent_type: 'COURIER_BIKE',
    city: 'ABUJA',
    latitude: 9.0815,
    longitude: 7.4662,
    h3_res8: latLngToHexCell(9.0815, 7.4662, 8),
    velocity_kmh: 29.8,
    heading_deg: 240,
    capacity_units: 4,
    active_load: 0,
    skill_tags: ['EXPRESS_BOX', 'FRAGILE'],
    rolling_1h_on_time_rate: 0.964,
    status: 'AVAILABLE',
    telemetry_source: 'HARDWARE_GPS',
    last_ping_at: new Date().toISOString(),
  },
  {
    id: 'agent_abj_03',
    callsign: 'ABJ-KYC-309 (Amina S.)',
    agent_type: 'KYC_FIELD_OFFICER',
    city: 'ABUJA',
    latitude: 9.0412,
    longitude: 7.4981,
    h3_res8: latLngToHexCell(9.0412, 7.4981, 8),
    velocity_kmh: 24.5,
    heading_deg: 45,
    capacity_units: 6,
    active_load: 1,
    skill_tags: ['KYC_TIER3', 'BIOMETRIC_POS', 'EXPRESS_BOX'],
    rolling_1h_on_time_rate: 0.991,
    status: 'AVAILABLE',
    telemetry_source: 'HARDWARE_GPS',
    last_ping_at: new Date().toISOString(),
  },
  {
    id: 'agent_abj_04',
    callsign: 'ABJ-VAN-412 (Ibrahim K.)',
    agent_type: 'DISPATCH_VAN',
    city: 'ABUJA',
    latitude: 9.0685,
    longitude: 7.4312,
    h3_res8: latLngToHexCell(9.0685, 7.4312, 8),
    velocity_kmh: 41.0,
    heading_deg: 90,
    capacity_units: 20,
    active_load: 3,
    skill_tags: ['BULK_CARGO', 'EXPRESS_BOX', 'FIELD_ENGINEER'],
    rolling_1h_on_time_rate: 0.953,
    status: 'AVAILABLE',
    telemetry_source: 'HARDWARE_GPS',
    last_ping_at: new Date().toISOString(),
  },
  {
    id: 'agent_abj_05',
    callsign: 'ABJ-MED-911 (FCT Rapid Unit 2)',
    agent_type: 'EMERGENCY_UNIT',
    city: 'ABUJA',
    latitude: 9.0844,
    longitude: 7.4892,
    h3_res8: latLngToHexCell(9.0844, 7.4892, 8),
    velocity_kmh: 52.4,
    heading_deg: 180,
    capacity_units: 2,
    active_load: 0,
    skill_tags: ['ALS_CERTIFIED', 'TRAUMA_KIT', 'EXPRESS_BOX'],
    rolling_1h_on_time_rate: 0.995,
    status: 'AVAILABLE',
    telemetry_source: 'HARDWARE_GPS',
    last_ping_at: new Date().toISOString(),
  },
  {
    id: 'agent_los_01',
    callsign: 'LOS-RIDER-501 (Tunde A.)',
    agent_type: 'COURIER_BIKE',
    city: 'LAGOS',
    latitude: 6.4451,
    longitude: 3.4689,
    h3_res8: latLngToHexCell(6.4451, 3.4689, 8),
    velocity_kmh: 27.6,
    heading_deg: 75,
    capacity_units: 4,
    active_load: 1,
    skill_tags: ['EXPRESS_BOX', 'COLD_CHAIN', 'LEKKI_PASS'],
    rolling_1h_on_time_rate: 0.978,
    status: 'AVAILABLE',
    telemetry_source: 'HARDWARE_GPS',
    last_ping_at: new Date().toISOString(),
  },
  {
    id: 'agent_los_02',
    callsign: 'LOS-RIDER-519 (Segun B.)',
    agent_type: 'COURIER_BIKE',
    city: 'LAGOS',
    latitude: 6.4338,
    longitude: 3.4281,
    h3_res8: latLngToHexCell(6.4338, 3.4281, 8),
    velocity_kmh: 31.4,
    heading_deg: 310,
    capacity_units: 4,
    active_load: 0,
    skill_tags: ['EXPRESS_BOX', 'KYC_VERIFIED'],
    rolling_1h_on_time_rate: 0.969,
    status: 'AVAILABLE',
    telemetry_source: 'HARDWARE_GPS',
    last_ping_at: new Date().toISOString(),
  },
  {
    id: 'agent_los_03',
    callsign: 'LOS-RIDER-604 (Emeka N.)',
    agent_type: 'COURIER_BIKE',
    city: 'LAGOS',
    latitude: 6.5789,
    longitude: 3.3592,
    h3_res8: latLngToHexCell(6.5789, 3.3592, 8),
    velocity_kmh: 33.1,
    heading_deg: 160,
    capacity_units: 4,
    active_load: 1,
    skill_tags: ['EXPRESS_BOX', 'FRAGILE'],
    rolling_1h_on_time_rate: 0.985,
    status: 'AVAILABLE',
    telemetry_source: 'HARDWARE_GPS',
    last_ping_at: new Date().toISOString(),
  },
  {
    id: 'agent_los_04',
    callsign: 'LOS-RIDER-622 (Sadiq M.)',
    agent_type: 'COURIER_BIKE',
    city: 'LAGOS',
    latitude: 6.5121,
    longitude: 3.3761,
    h3_res8: latLngToHexCell(6.5121, 3.3761, 8),
    velocity_kmh: 26.9,
    heading_deg: 20,
    capacity_units: 4,
    active_load: 0,
    skill_tags: ['EXPRESS_BOX', 'COLD_CHAIN'],
    rolling_1h_on_time_rate: 0.971,
    status: 'AVAILABLE',
    telemetry_source: 'HARDWARE_GPS',
    last_ping_at: new Date().toISOString(),
  },
  {
    id: 'agent_ekt_01',
    callsign: 'EKT-RIDER-701 (Femi D.)',
    agent_type: 'COURIER_BIKE',
    city: 'ADO-EKITI',
    latitude: 7.6185,
    longitude: 5.2194,
    h3_res8: latLngToHexCell(7.6185, 5.2194, 8),
    velocity_kmh: 35.0,
    heading_deg: 65,
    capacity_units: 4,
    active_load: 0,
    skill_tags: ['EXPRESS_BOX', 'KYC_TIER3'],
    rolling_1h_on_time_rate: 0.988,
    status: 'AVAILABLE',
    telemetry_source: 'HARDWARE_GPS',
    last_ping_at: new Date().toISOString(),
  },
];

export const TENANT_PROFILES: Record<string, TenantProfile> = {
  tenant_logistics_ng: {
    id: 'tenant_logistics_ng',
    name: 'Partner Delivery Network',
    industry_vertical: 'LOGISTICS',
    max_search_radius_m: 8000,
    required_lookup_level: 3,
    sla_target_sec: 1800,
    ml_profile: 'logistics_eta_v1',
  },
  tenant_fintech_kyc: {
    id: 'tenant_fintech_kyc',
    name: 'Moniepoint / Tier-3 Merchant KYC',
    industry_vertical: 'BANKING_KYC',
    max_search_radius_m: 5000,
    required_lookup_level: 3,
    sla_target_sec: 900,
    ml_profile: 'kyc_verification_v1',
  },
  tenant_emergency_fct: {
    id: 'tenant_emergency_fct',
    name: 'FCT NEMA / Rapid Medical Dispatch',
    industry_vertical: 'EMERGENCY_RESPONSE',
    max_search_radius_m: 15000,
    required_lookup_level: 3,
    sla_target_sec: 600,
    ml_profile: 'emergency_intercept_v1',
  },
  tenant_field_infra: {
    id: 'tenant_field_infra',
    name: 'IHS Towers / Fiber Grid Maintenance',
    industry_vertical: 'FIELD_OPS',
    max_search_radius_m: 20000,
    required_lookup_level: 3,
    sla_target_sec: 3600,
    ml_profile: 'field_mttr_v1',
  },
};

class DataStore {
  public mysqlPool: mysql.Pool | null = null;
  public redis: Redis | null = null;
  public mysqlConnected = false;
  public redisConnected = false;

  // High-speed state mirror synced with MySQL & Redis
  public postcodeMap = new Map<string, NipostLookupResult>();
  public agentMap = new Map<string, AgentRecord>();
  public taskMap = new Map<string, DispatchTaskRecord>();
  public idempotencyMap = new Map<string, DispatchTaskRecord>();
  public kycList: KycVerificationRecord[] = [];
  public fieldObservationList: FieldObservationRecord[] = [];
  public fieldAgentByEmail = new Map<string, FieldAgentAccount>();
  public fieldAgentById = new Map<string, FieldAgentAccount>();
  public redisCacheMirror = new Map<string, { value: string; expiresAt: number }>();
  public distributedLocks = new Map<string, { owner: string; expiresAt: number }>();
  public h3VelocityMap = new Map<string, number>();

  constructor() {
    for (const item of INITIAL_POSTCODE_REGISTRY) {
      // These records make local development and automated tests deterministic. They must
      // never be presented to a user as an official NIPOST lookup.
      this.postcodeMap.set(item.postcode, {
        ...item,
        source: 'LOCAL_DEVELOPMENT_FIXTURE',
      });
    }
    for (const ag of INITIAL_AGENTS) {
      this.agentMap.set(ag.id, ag);
      this.h3VelocityMap.set(ag.h3_res8, ag.velocity_kmh);
    }
  }

  public async initialize(): Promise<void> {
    // 1. Attempt Redis connection
    try {
      const redisClient = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
        retryStrategy: () => null,
      });
      redisClient.on('error', () => {
        this.redisConnected = false;
      });
      await redisClient.connect();
      await redisClient.ping();
      this.redis = redisClient;
      this.redisConnected = true;

      // Sync agents into Redis GEOADD
      for (const ag of this.agentMap.values()) {
        await this.redis.geoadd('resolvegrid:agents:geo', ag.longitude, ag.latitude, ag.id);
      }
    } catch {
      this.redisConnected = false;
      this.redis = null;
    }

    // 2. Attempt MySQL 8.0 connection
    try {
      const pool = mysql.createPool({
        host: process.env.MYSQL_HOST || '127.0.0.1',
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER || 'resolvegrid',
        password: process.env.MYSQL_PASSWORD || 'resolvegrid_secret_2026',
        database: process.env.MYSQL_DATABASE || 'resolvegrid',
        waitForConnections: true,
        connectionLimit: 10,
        connectTimeout: 2500,
      });
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      this.mysqlPool = pool;
      this.mysqlConnected = true;
      const [rows] = (await pool.query(
        `SELECT id, applicant_ref, claimed_postcode, reverse_geocoded_postcode,
                device_lat, device_lng, gps_accuracy_m, distance_to_building_m,
                building_use_status, verification_status, hmac_signature, verified_at
           FROM kyc_verifications
          ORDER BY verified_at DESC
          LIMIT 50`
      )) as unknown as [KycVerificationRecord[], unknown];
      this.kycList = rows.map((row) => ({
        ...row,
        device_lat: Number(row.device_lat),
        device_lng: Number(row.device_lng),
        gps_accuracy_m: Number(row.gps_accuracy_m),
        distance_to_building_m: Number(row.distance_to_building_m),
        verified_at: new Date(row.verified_at).toISOString(),
      }));

      const [fieldRows] = (await pool.query(
        `SELECT id, postcode, agent_id, device_lat, device_lng, gps_accuracy_m,
                gate_clearance_required, measured_gate_delay_sec, compound_walk_meters,
                building_access_notes, status, observed_at
           FROM field_observations
          ORDER BY observed_at DESC
          LIMIT 50`
      )) as unknown as [FieldObservationRecord[], unknown];
      this.fieldObservationList = fieldRows.map((row) => ({
        ...row,
        device_lat: Number(row.device_lat),
        device_lng: Number(row.device_lng),
        gps_accuracy_m: Number(row.gps_accuracy_m),
        gate_clearance_required: Boolean(row.gate_clearance_required),
        measured_gate_delay_sec: Number(row.measured_gate_delay_sec),
        compound_walk_meters: Number(row.compound_walk_meters),
        observed_at: new Date(row.observed_at).toISOString(),
      }));

      const [agentRows] = (await pool.query(
        `SELECT id, agent_id, email, display_name, password_hash, active, created_at, last_login_at
           FROM field_agents`
      )) as unknown as [FieldAgentAccount[], unknown];
      for (const row of agentRows) {
        const account: FieldAgentAccount = {
          ...row,
          email: row.email.toLowerCase(),
          active: Boolean(row.active),
          created_at: new Date(row.created_at).toISOString(),
          last_login_at: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        };
        this.fieldAgentByEmail.set(account.email, account);
        this.fieldAgentById.set(account.id, account);
      }
    } catch {
      this.mysqlConnected = false;
      this.mysqlPool = null;
    }
  }

  public async cacheGet(key: string): Promise<string | null> {
    if (this.redis && this.redisConnected) {
      try {
        return await this.redis.get(key);
      } catch {
        // Fallback to local mirror
      }
    }
    const entry = this.redisCacheMirror.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.redisCacheMirror.delete(key);
      return null;
    }
    return entry.value;
  }

  public async cacheSet(key: string, value: string, ttlSeconds = 3600): Promise<void> {
    this.redisCacheMirror.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    if (this.redis && this.redisConnected) {
      try {
        await this.redis.set(key, value, 'EX', ttlSeconds);
      } catch {
        // Ignore transient Redis error
      }
    }
  }

  /**
   * Acquires an atomic Redlock / SETNX lock for a candidate agent.
   */
  public async acquireAgentLock(agentId: string, taskId: string, ttlMs = 15000): Promise<boolean> {
    const lockKey = `resolvegrid:lock:agent:${agentId}`;
    if (this.redis && this.redisConnected) {
      try {
        const res = await this.redis.set(lockKey, taskId, 'PX', ttlMs, 'NX');
        return res === 'OK';
      } catch {
        // Fallback to in-process atomic check
      }
    }
    const existing = this.distributedLocks.get(lockKey);
    if (existing && existing.expiresAt > Date.now()) {
      return false;
    }
    this.distributedLocks.set(lockKey, { owner: taskId, expiresAt: Date.now() + ttlMs });
    return true;
  }

  /**
   * Sub-millisecond Geospatial Candidate Search (Redis GEOSEARCH + Haversine verification)
   */
  public async geoSearchAgents(
    lat: number,
    lng: number,
    radiusMeters: number
  ): Promise<{ agent: AgentRecord; distance_m: number }[]> {
    const results: { agent: AgentRecord; distance_m: number }[] = [];

    if (this.redis && this.redisConnected) {
      try {
        const rawIds = (await this.redis.call(
          'GEOSEARCH',
          'resolvegrid:agents:geo',
          'FROMLONLAT',
          String(lng),
          String(lat),
          'BYRADIUS',
          String(radiusMeters),
          'm',
          'ASC'
        )) as string[];

        for (const id of rawIds) {
          const ag = this.agentMap.get(id);
          if (ag && ag.status === 'AVAILABLE') {
            results.push({
              agent: ag,
              distance_m: haversineMeters(lat, lng, ag.latitude, ag.longitude),
            });
          }
        }
        if (results.length > 0) {
          return results;
        }
      } catch {
        // Fallback to direct spatial scan
      }
    }

    for (const ag of this.agentMap.values()) {
      if (ag.status !== 'AVAILABLE') continue;
      const dist = haversineMeters(lat, lng, ag.latitude, ag.longitude);
      if (dist <= radiusMeters) {
        results.push({ agent: ag, distance_m: dist });
      }
    }

    results.sort((a, b) => a.distance_m - b.distance_m);
    return results;
  }

  public async updateAgentPosition(
    agentId: string,
    lat: number,
    lng: number,
    velocityKmh?: number,
    headingDeg?: number,
    telemetrySource = 'HARDWARE_GPS'
  ): Promise<AgentRecord | null> {
    let ag = this.agentMap.get(agentId);
    if (!ag) {
      ag = {
        id: agentId,
        callsign: `FIELD-UNIT-${agentId.slice(-4).toUpperCase()}`,
        agent_type: 'COURIER_BIKE',
        city: lat > 8.0 ? 'ABUJA' : 'LAGOS',
        latitude: lat,
        longitude: lng,
        h3_res8: latLngToHexCell(lat, lng, 8),
        velocity_kmh: velocityKmh ?? 30.0,
        heading_deg: headingDeg ?? 0,
        capacity_units: 4,
        active_load: 0,
        skill_tags: ['EXPRESS_BOX', 'KYC_VERIFIED'],
        rolling_1h_on_time_rate: 0.98,
        status: 'AVAILABLE',
        telemetry_source: telemetrySource,
        last_ping_at: new Date().toISOString(),
      };
    } else {
      const elapsedSec = Math.max(
        1,
        (Date.now() - new Date(ag.last_ping_at).getTime()) / 1000
      );
      const distMoved = haversineMeters(ag.latitude, ag.longitude, lat, lng);
      const computedVel =
        velocityKmh !== undefined
          ? velocityKmh
          : Math.min(95, Math.max(12, (distMoved / elapsedSec) * 3.6));

      ag.latitude = lat;
      ag.longitude = lng;
      ag.h3_res8 = latLngToHexCell(lat, lng, 8);
      ag.velocity_kmh = Number(computedVel.toFixed(1));
      if (headingDeg !== undefined) ag.heading_deg = headingDeg;
      ag.telemetry_source = telemetrySource;
      ag.last_ping_at = new Date().toISOString();
    }

    this.agentMap.set(agentId, ag);
    this.h3VelocityMap.set(ag.h3_res8, ag.velocity_kmh);

    if (this.redis && this.redisConnected) {
      try {
        await this.redis.geoadd('resolvegrid:agents:geo', lng, lat, agentId);
        await this.redis.hset(`resolvegrid:h3:${ag.h3_res8}`, 'velocity_kmh', String(ag.velocity_kmh));
      } catch {
        // Ignore transient Redis error
      }
    }

    if (this.mysqlPool && this.mysqlConnected) {
      try {
        await this.mysqlPool.execute(
          `UPDATE agents SET latitude = ?, longitude = ?, h3_res8 = ?, velocity_kmh = ?, heading_deg = ?, telemetry_source = ?, last_ping_at = NOW() WHERE id = ?`,
          [ag.latitude, ag.longitude, ag.h3_res8, ag.velocity_kmh, ag.heading_deg, ag.telemetry_source, ag.id]
        );
      } catch {
        // Ignore transient MySQL error
      }
    }

    return ag;
  }

  public async upsertPostcodeRecord(record: NipostLookupResult): Promise<void> {
    this.postcodeMap.set(record.postcode, record);
    if (this.mysqlPool && this.mysqlConnected && record.coordinates) {
      try {
        await this.mysqlPool.execute(
          `INSERT INTO postcode_registry (
            postcode, compact_code, display_code, state_code, lga_code, district_code, area_code, unit_code,
            legacy_postal_code, state_name, lga_name, locality_name, geopolitical_zone,
            street_address, landmark_notes, building_use_status, latitude, longitude, h3_res8, h3_res10, lookup_level, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            street_address = VALUES(street_address),
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            source = VALUES(source)`,
          [
            record.postcode,
            record.compact,
            record.display,
            record.administrative_address.state_code,
            record.administrative_address.lga_code,
            record.administrative_address.district_code,
            record.postcode.split('-')[3] || 'AA',
            record.postcode.split('-')[4] || '01',
            record.legacy_postal_code,
            record.administrative_address.state_name,
            record.administrative_address.lga_name,
            record.administrative_address.locality_name,
            record.administrative_address.zone,
            record.recent_house_address?.recent || record.administrative_address.locality_name,
            record.recent_house_address?.landmark_notes || null,
            (record.building_use_status || 'commercial') as BuildingUseStatus,
            record.coordinates.latitude,
            record.coordinates.longitude,
            record.coordinates.h3_res8,
            record.coordinates.h3_res10,
            3,
            record.source,
          ]
        );
      } catch {
        // Ignore transient DB write error
      }
    }
  }

  /** Save an auditable location-verification record and retain a small live mirror for the API. */
  public async saveKycVerification(record: KycVerificationRecord): Promise<void> {
    this.kycList.unshift(record);
    if (this.kycList.length > 50) this.kycList.pop();

    if (!this.mysqlPool || !this.mysqlConnected) return;
    try {
      await this.mysqlPool.execute(
        `INSERT INTO kyc_verifications (
          id, applicant_ref, claimed_postcode, reverse_geocoded_postcode,
          device_lat, device_lng, gps_accuracy_m, distance_to_building_m,
          building_use_status, verification_status, hmac_signature, verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.applicant_ref,
          record.claimed_postcode,
          record.reverse_geocoded_postcode,
          record.device_lat,
          record.device_lng,
          record.gps_accuracy_m,
          record.distance_to_building_m,
          record.building_use_status,
          record.verification_status,
          record.hmac_signature,
          record.verified_at,
        ]
      );
    } catch {
      // Keep the request usable during a temporary database outage; the API exposes database health.
    }
  }

  /** Persist a field-captured access observation without mutating trusted postcode data directly. */
  public async saveFieldObservation(record: FieldObservationRecord): Promise<void> {
    this.fieldObservationList.unshift(record);
    if (this.fieldObservationList.length > 50) this.fieldObservationList.pop();

    if (!this.mysqlPool || !this.mysqlConnected) return;
    try {
      await this.mysqlPool.execute(
        `INSERT INTO field_observations (
          id, postcode, agent_id, device_lat, device_lng, gps_accuracy_m,
          gate_clearance_required, measured_gate_delay_sec, compound_walk_meters,
          building_access_notes, status, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.postcode,
          record.agent_id,
          record.device_lat,
          record.device_lng,
          record.gps_accuracy_m,
          record.gate_clearance_required,
          record.measured_gate_delay_sec,
          record.compound_walk_meters,
          record.building_access_notes,
          record.status,
          record.observed_at,
        ]
      );
    } catch {
      // The in-memory mirror lets the field app receive its submission receipt during a transient outage.
    }
  }

  public async saveFieldAgent(account: FieldAgentAccount): Promise<void> {
    if (!this.mysqlPool || !this.mysqlConnected) {
      throw new Error('Field-agent accounts require an available MySQL database.');
    }
    await this.mysqlPool.execute(
      `INSERT INTO field_agents (
        id, agent_id, email, display_name, password_hash, active, created_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        account.id,
        account.agent_id,
        account.email,
        account.display_name,
        account.password_hash,
        account.active,
        account.created_at,
        account.last_login_at,
      ]
    );
    this.fieldAgentByEmail.set(account.email, account);
    this.fieldAgentById.set(account.id, account);
  }

  public async markFieldAgentLogin(id: string): Promise<void> {
    const account = this.fieldAgentById.get(id);
    if (!account) return;
    account.last_login_at = new Date().toISOString();
    if (this.mysqlPool && this.mysqlConnected) {
      await this.mysqlPool.execute('UPDATE field_agents SET last_login_at = NOW() WHERE id = ?', [id]);
    }
  }
}

export const store = new DataStore();
