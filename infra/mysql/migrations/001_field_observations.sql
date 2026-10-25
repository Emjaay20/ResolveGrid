-- Apply this once to existing ResolveGrid databases created before the
-- audited field-observation workflow was introduced.
CREATE TABLE IF NOT EXISTS field_observations (
  id VARCHAR(64) PRIMARY KEY,
  postcode VARCHAR(16) NOT NULL,
  agent_id VARCHAR(64) NOT NULL,
  device_lat DECIMAL(10, 7) NOT NULL,
  device_lng DECIMAL(10, 7) NOT NULL,
  gps_accuracy_m DECIMAL(7, 2) NOT NULL,
  gate_clearance_required BOOLEAN NOT NULL,
  measured_gate_delay_sec INT NOT NULL,
  compound_walk_meters INT NOT NULL DEFAULT 0,
  building_access_notes VARCHAR(500) DEFAULT NULL,
  status ENUM('SUBMITTED') NOT NULL DEFAULT 'SUBMITTED',
  observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_observation_postcode
    FOREIGN KEY (postcode) REFERENCES postcode_registry(postcode) ON DELETE RESTRICT,
  INDEX idx_field_observation_postcode (postcode, observed_at),
  INDEX idx_field_observation_agent (agent_id, observed_at)
) ENGINE=InnoDB;
