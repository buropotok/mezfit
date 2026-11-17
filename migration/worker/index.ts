import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { traceWriter, classifyTraceError } from '../trace.mjs';
import { consumeUploads } from './events';
import { SMOKE_ID_PATTERN } from './r2-upload';
import { cleanupMigrationSmoke, runMigrationSmoke, type SmokeBindings } from './smoke';

export default { queue: consumeUploads } satisfies ExportedHandler<SmokeBindings, unknown>;

type MigrationOperation = ({ operation: 'smoke' } | { operation: 'cleanup'; targetId: string }) & { runId?: string };

export class MigrationWorkflow extends WorkflowEntrypoint<SmokeBindings, MigrationOperation> {
  async run(event: WorkflowEvent<MigrationOperation>, step: WorkflowStep): Promise<string> {
    const traceId = event.payload?.operation === 'cleanup' ? event.payload.targetId : event.instanceId;
    const context = { trace_id: traceId, instance_id: event.instanceId, run_id: event.payload?.runId,
      worker_version: this.env.MIGRATION_VERSION?.id };
    const emit = traceWriter(context);
    const start = Date.now();
    emit('workflow', 'invocation', 'WORKFLOW_INVOCATION', 'STARTED', { expected: 'valid-workflow-operation' });
    try {
      if (event.payload?.operation === 'cleanup' && typeof event.payload.targetId === 'string'
        && SMOKE_ID_PATTERN.test(event.payload.targetId)) {
        const result = await cleanupMigrationSmoke(this.env, event.payload.targetId, step, context);
        emit('workflow', 'invocation', 'WORKFLOW_INVOCATION', 'OK', { actual: 'cleanup-completed', duration_ms: Date.now() - start });
        return result;
      }
      if (event.payload?.operation !== 'smoke' || !SMOKE_ID_PATTERN.test(event.instanceId)) {
        throw new NonRetryableError('SMOKE_WORKFLOW_INPUT_INVALID|configuration|smoke-payload-and-uuid|invalid-input');
      }
      const result = await runMigrationSmoke(this.env, event.instanceId, step, message => new NonRetryableError(message), context);
      emit('workflow', 'invocation', 'WORKFLOW_INVOCATION', 'OK', { actual: 'smoke-completed', duration_ms: Date.now() - start });
      return result;
    } catch (error) {
      emit('workflow', 'invocation', 'WORKFLOW_INVOCATION', 'FAILED', { actual: 'invocation-rejected',
        error_code: 'WORKFLOW_INVOCATION_FAILED', duration_ms: Date.now() - start, details: { classification: classifyTraceError(error) } });
      throw error;
    }
  }
}
