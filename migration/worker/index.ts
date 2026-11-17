import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { consumeUploads } from './events';
import { SMOKE_ID_PATTERN } from './r2-upload';
import { cleanupMigrationSmoke, runMigrationSmoke, type SmokeBindings } from './smoke';

export default { queue: consumeUploads } satisfies ExportedHandler<SmokeBindings, unknown>;

type MigrationOperation = { operation: 'smoke' } | { operation: 'cleanup'; targetId: string };

export class MigrationWorkflow extends WorkflowEntrypoint<SmokeBindings, MigrationOperation> {
  async run(event: WorkflowEvent<MigrationOperation>, step: WorkflowStep): Promise<string> {
    if (event.payload?.operation === 'cleanup' && typeof event.payload.targetId === 'string'
      && SMOKE_ID_PATTERN.test(event.payload.targetId)) {
      return cleanupMigrationSmoke(this.env, event.payload.targetId, step);
    }
    if (event.payload?.operation !== 'smoke' || !SMOKE_ID_PATTERN.test(event.instanceId)) {
      throw new NonRetryableError('SMOKE_WORKFLOW_INPUT_INVALID|configuration|smoke-payload-and-uuid|invalid-input');
    }
    return runMigrationSmoke(this.env, event.instanceId, step, message => new NonRetryableError(message));
  }
}
