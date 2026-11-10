-- Relabel shared demo profiles and seed agents so no real organisation or person
-- is implied. Safe to run more than once.
UPDATE tenants SET name = 'Merchant KYC Verification (demo profile)' WHERE id = 'tenant_fintech_kyc';
UPDATE tenants SET name = 'Emergency Medical Dispatch (demo profile)' WHERE id = 'tenant_emergency_fct';
UPDATE tenants SET name = 'Field Infrastructure Maintenance (demo profile)' WHERE id = 'tenant_field_infra';
UPDATE tenants SET name = 'Delivery Network (demo profile)' WHERE id = 'tenant_logistics_ng';

UPDATE agents
   SET callsign = CONCAT(SUBSTRING_INDEX(callsign, ' (', 1), ' (demo)'),
       telemetry_source = 'DEMO_SEED_POSITION'
 WHERE id IN ('agent_abj_01','agent_abj_02','agent_abj_03','agent_abj_04','agent_abj_05',
              'agent_los_01','agent_los_02','agent_los_03','agent_los_04','agent_ekt_01')
   AND telemetry_source = 'HARDWARE_GPS';
