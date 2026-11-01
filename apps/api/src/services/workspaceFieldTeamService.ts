import { RowDataPacket } from 'mysql2/promise';
import { store } from '../config/datastore';

export interface WorkspaceFieldAgent {
  agent_id: string;
  display_name: string;
  email: string;
  active: boolean;
  linked_at: string;
}

export class WorkspaceFieldTeamService {
  private get pool() {
    if (!store.mysqlPool || !store.mysqlConnected) {
      throw new Error('Field-team management requires an available MySQL database.');
    }
    return store.mysqlPool;
  }

  public async ensureSchema(): Promise<void> {
    if (!store.mysqlPool || !store.mysqlConnected) return;
    await store.mysqlPool.execute(`CREATE TABLE IF NOT EXISTS workspace_field_agents (
      tenant_id VARCHAR(64) NOT NULL,
      agent_id VARCHAR(64) NOT NULL,
      linked_by_user_id VARCHAR(64) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, agent_id),
      CONSTRAINT fk_workspace_field_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_workspace_field_agent FOREIGN KEY (agent_id) REFERENCES field_agents(agent_id) ON DELETE RESTRICT,
      INDEX idx_workspace_field_agent (agent_id)
    ) ENGINE=InnoDB`);
  }

  public async list(tenantId: string): Promise<WorkspaceFieldAgent[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT f.agent_id, f.display_name, f.email, f.active, w.created_at AS linked_at
         FROM workspace_field_agents w
         INNER JOIN field_agents f ON f.agent_id = w.agent_id
        WHERE w.tenant_id = ?
        ORDER BY f.display_name ASC`,
      [tenantId]
    );
    return rows.map((row) => ({
      agent_id: String(row.agent_id),
      display_name: String(row.display_name),
      email: String(row.email),
      active: Boolean(row.active),
      linked_at: new Date(row.linked_at).toISOString(),
    }));
  }

  public async assign(tenantId: string, agentId: string, actorUserId: string): Promise<void> {
    const account = Array.from(store.fieldAgentById.values()).find(
      (candidate) => candidate.agent_id === agentId && candidate.active
    );
    if (!account) throw new Error('That active field-agent account does not exist.');
    await this.pool.execute(
      `INSERT IGNORE INTO workspace_field_agents (tenant_id, agent_id, linked_by_user_id)
       VALUES (?, ?, ?)`,
      [tenantId, agentId, actorUserId]
    );
  }

  public async hasAgent(tenantId: string, agentId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM workspace_field_agents w
       INNER JOIN field_agents f ON f.agent_id = w.agent_id AND f.active = TRUE
       WHERE w.tenant_id = ? AND w.agent_id = ? LIMIT 1`,
      [tenantId, agentId]
    );
    return rows.length > 0;
  }
}

export const workspaceFieldTeamService = new WorkspaceFieldTeamService();
