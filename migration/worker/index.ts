import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { traceWriter, classifyTraceError } from '../trace.mjs';
import { PROCESSOR_VERSION, processorInstanceId } from '../processor-protocol.mjs';
import { type ProcessOperation, type QueueExecutionBindings } from './execution-store';
import { runProcess } from './process-workflow';
import { cleanupProcessorSmoke, processorReadiness, runProcessorSmoke } from './processor-smoke';
import { consumeUploads } from './events';
import { SMOKE_ID_PATTERN } from './r2-upload';
import { cleanupMigrationSmoke, runMigrationSmoke, type SmokeBindings } from './smoke';

type Bindings = SmokeBindings & QueueExecutionBindings;
export default { queue: consumeUploads } satisfies ExportedHandler<Bindings, unknown>;

type MigrationOperation = (ProcessOperation | { operation: 'smoke' | 'processor-ready' }
  | { operation: 'processor-smoke'; jobId: string; expectedVersion: string }
  | { operation: 'cleanup' | 'processor-cleanup'; targetId: string }) & { runId?: string };
const WORKER_VERSION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export class MigrationWorkflow extends WorkflowEntrypoint<Bindings, MigrationOperation> {
  async run(event: WorkflowEvent<MigrationOperation>, step: WorkflowStep): Promise<string> {
    const payload = event.payload;
    const processorOperation = payload?.operation === 'process' || typeof payload?.operation === 'string' && payload.operation.startsWith('processor-');
    const traceId = payload?.operation === 'cleanup' || payload?.operation === 'processor-cleanup' ? payload.targetId
      : payload?.operation === 'process' || payload?.operation === 'processor-smoke' ? payload.jobId : event.instanceId;
    const context = { trace_id: traceId, instance_id: event.instanceId, run_id: payload?.runId,
      worker_version: this.env.MIGRATION_VERSION?.id,
      ...(processorOperation ? { job_id: traceId, processor_version: PROCESSOR_VERSION } : {}) };
    const emit = traceWriter(context);
    const start = Date.now();
    emit('workflow', 'invocation', 'WORKFLOW_INVOCATION', 'STARTED', { expected: 'valid-workflow-operation' });
    try {
      const permanent = (code: string) => new NonRetryableError(code);
      if (processorOperation) {
        const validId = typeof traceId === 'string' && SMOKE_ID_PATTERN.test(traceId);
        const expectedVersion = payload?.operation === 'process' || payload?.operation === 'processor-smoke'
          ? payload.expectedVersion : undefined;
        const valid = validId && (payload?.operation === 'process'
          ? event.instanceId === processorInstanceId(traceId)
          : SMOKE_ID_PATTERN.test(event.instanceId))
          && (expectedVersion === undefined ? payload?.operation !== 'processor-smoke'
            : typeof expectedVersion === 'string' && WORKER_VERSION.test(expectedVersion));
        emit('workflow', 'process-payload', 'PROCESS_PAYLOAD_VALIDATED', valid ? 'OK' : 'FAILED',
          { expected: 'valid-processor-operation', error_code: valid ? undefined : 'PROCESS_WORKFLOW_INPUT_INVALID' });
        if (!valid) throw permanent('PROCESS_WORKFLOW_INPUT_INVALID');
        if (payload?.operation === 'process') return await runProcess(this.env, step, traceId, context,
          expectedVersion === undefined || this.env.MIGRATION_VERSION?.id === expectedVersion);
        if (payload?.operation === 'processor-ready') return await processorReadiness(this.env, step, context);
        if (payload?.operation === 'processor-smoke') return await runProcessorSmoke(this.env, traceId, step, context,
          payload.expectedVersion, permanent);
        if (payload?.operation === 'processor-cleanup') return await cleanupProcessorSmoke(this.env, traceId, step, context, permanent);
      }
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
