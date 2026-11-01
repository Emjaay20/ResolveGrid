-- Named field agents belong to an approved pilot workspace before a plan can
-- be assigned to them. Accounts remain provisioned identities, not public sign-ups.
CREATE TABLE IF NOT EXISTS workspace_field_agents (
  tenant_id VARCHAR(64) NOT NULL,
  agent_id VARCHAR(64) NOT NULL,
  linked_by_user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, agent_id),
  CONSTRAINT fk_workspace_field_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_field_agent FOREIGN KEY (agent_id) REFERENCES field_agents(agent_id) ON DELETE RESTRICT,
  INDEX idx_workspace_field_agent (agent_id)
) ENGINE=InnoDB;
