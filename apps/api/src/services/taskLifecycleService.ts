import crypto from 'node:crypto';
import { DispatchTaskRecord, store } from '../config/datastore';

export type FieldTaskAction = 'ACCEPTED' | 'EN_ROUTE' | 'DECLINED';

export class TaskLifecycleService {
  public async ensureSchema(): Promise<void> {
    if (!store.mysqlPool || !store.mysqlConnected) return;
    await store.mysqlPool.execute(`ALTER TABLE dispatch_tasks MODIFY status ENUM('DISPATCHED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED_VERIFIED', 'DECLINED', 'CANCELLED') NOT NULL DEFAULT 'DISPATCHED'`);
    await store.mysqlPool.execute(`CREATE TABLE IF NOT EXISTS task_events (
      id VARCHAR(64) PRIMARY KEY,
      task_id VARCHAR(64) NOT NULL,
      event_type ENUM('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'DECLINED', 'CANCELLED', 'ARRIVED_VERIFIED') NOT NULL,
      actor_type ENUM('OPERATOR', 'FIELD_AGENT', 'SYSTEM') NOT NULL,
      actor_id VARCHAR(64) DEFAULT NULL,
      note VARCHAR(500) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_task_events_task (task_id, created_at)
    ) ENGINE=InnoDB`);
  }

  private async event(taskId: string, eventType: FieldTaskAction | 'ASSIGNED' | 'CANCELLED' | 'ARRIVED_VERIFIED', actorType: 'OPERATOR' | 'FIELD_AGENT' | 'SYSTEM', actorId?: string, note?: string): Promise<void> {
    if (!store.mysqlPool || !store.mysqlConnected) return;
    await store.mysqlPool.execute(
      `INSERT INTO task_events (id, task_id, event_type, actor_type, actor_id, note) VALUES (?, ?, ?, ?, ?, ?)`,
      [`evt_${crypto.randomUUID().slice(0, 22)}`, taskId, eventType, actorType, actorId || null, note || null]
    );
  }

  public async fieldAction(taskId: string, agentId: string, action: FieldTaskAction, note?: string): Promise<DispatchTaskRecord> {
    const task = store.taskMap.get(taskId);
    if (!task) throw new Error('Task not found. Refresh your assigned plans.');
    if (task.assigned_agent_id !== agentId) throw new Error('This task is assigned to a different field agent.');
    const allowed: Record<FieldTaskAction, DispatchTaskRecord['status'][]> = {
      ACCEPTED: ['ASSIGNED', 'DISPATCHED'],
      EN_ROUTE: ['ACCEPTED'],
      DECLINED: ['ASSIGNED', 'DISPATCHED', 'ACCEPTED'],
    };
    if (!allowed[action].includes(task.status)) throw new Error(`This task cannot be marked ${action.toLowerCase()} from its current state.`);
    task.status = action;
    store.taskMap.set(task.id, task);
    if (store.mysqlPool && store.mysqlConnected) {
      await store.mysqlPool.execute('UPDATE dispatch_tasks SET status = ? WHERE id = ?', [action, task.id]);
    }
    await this.event(task.id, action, 'FIELD_AGENT', agentId, note);
    return task;
  }

  public async cancel(taskId: string, workspaceId: string, actorId: string, note?: string): Promise<DispatchTaskRecord> {
    const task = store.taskMap.get(taskId);
    if (!task || task.tenant_id !== workspaceId) throw new Error('Task not found in this workspace.');
    if (['ARRIVED_VERIFIED', 'CANCELLED', 'DECLINED'].includes(task.status)) throw new Error('This task can no longer be cancelled.');
    task.status = 'CANCELLED';
    store.taskMap.set(task.id, task);
    if (store.mysqlPool && store.mysqlConnected) {
      await store.mysqlPool.execute('UPDATE dispatch_tasks SET status = ? WHERE id = ?', ['CANCELLED', task.id]);
    }
    await this.event(task.id, 'CANCELLED', 'OPERATOR', actorId, note);
    return task;
  }
}

export const taskLifecycleService = new TaskLifecycleService();
