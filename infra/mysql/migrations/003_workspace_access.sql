-- Invitation-only operator access for ResolveGrid pilot workspaces.
CREATE TABLE IF NOT EXISTS operator_users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_operator_active (active, email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS workspace_memberships (
  user_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  role ENUM('OWNER', 'DISPATCHER', 'REVIEWER') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tenant_id),
  CONSTRAINT fk_workspace_member_user FOREIGN KEY (user_id) REFERENCES operator_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_member_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_workspace_member_tenant (tenant_id, role)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  email VARCHAR(254) NOT NULL,
  role ENUM('DISPATCHER', 'REVIEWER') NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by_user_id VARCHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_workspace_invite_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_invite_sender FOREIGN KEY (invited_by_user_id) REFERENCES operator_users(id) ON DELETE CASCADE,
  INDEX idx_workspace_invite_email (email, expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS operator_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_operator_session_user FOREIGN KEY (user_id) REFERENCES operator_users(id) ON DELETE CASCADE,
  INDEX idx_operator_session_lookup (token_hash, expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_audit_events (
  id VARCHAR(64) PRIMARY KEY,
  actor_user_id VARCHAR(64) DEFAULT NULL,
  tenant_id VARCHAR(64) DEFAULT NULL,
  event_type VARCHAR(64) NOT NULL,
  metadata JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_audit_tenant (tenant_id, created_at),
  INDEX idx_auth_audit_actor (actor_user_id, created_at)
) ENGINE=InnoDB;
