-- Apply after 001_field_observations.sql for existing ResolveGrid databases.
CREATE TABLE IF NOT EXISTS field_agents (
  id VARCHAR(64) PRIMARY KEY,
  agent_id VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(254) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_field_agent_active (active, agent_id)
) ENGINE=InnoDB;
