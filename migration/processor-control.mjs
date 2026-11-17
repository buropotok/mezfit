import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const WORKER_DEPLOYMENTS = '/workers/scripts/mezfit-migration/deployments';
const INSTANCES = '/workflows/mezfit-migration-workflow/instances';
const ACTIVE = new Set(['queued', 'running', 'waiting', 'waitingForPause', 'rollingBack']);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const READY = 'MIGRATION_PROCESSOR_READY:';

function output(instance) {
  const value = instance?.output;
  if (typeof value !== 'string') return null;
  if (!value.startsWith('"')) return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : null;
  } catch { return null; }
}

export async function deployedWorkerVersion(api) {
  const { deployments } = await api.get(WORKER_DEPLOYMENTS) ?? {};
  const versions = deployments?.[0]?.versions;
  if (!Array.isArray(versions) || versions.length !== 1 || versions[0]?.percentage !== 100
    || typeof versions[0]?.version_id !== 'string' || !UUID.test(versions[0].version_id)) {
    throw new Error('DEPLOYED_VERSION_UNCONFIRMED');
  }
  return versions[0].version_id;
}

async function invoke(api, id, params, emit, deadline, wait) {
  const path = INSTANCES + '/' + id;
  const scope = { details: { operation: 'processor-smoke' } };
  emit('workflow', 'processor-instance-create', 'PROCESSOR_CONTROL_CREATE', 'STARTED', scope);
  try {
    await api.request(INSTANCES, { method: 'POST', body: { instance_id: id, params } });
    emit('workflow', 'processor-instance-create', 'PROCESSOR_CONTROL_CREATE', 'OK', scope);
  } catch (error) {
    if (!error?.transient && error?.status !== 409) throw error;
    emit('workflow', 'processor-instance-create', 'PROCESSOR_CONTROL_CREATE', 'NOT_OBSERVED', {
      actual: 'checking-same-instance', details: { http_status: error?.status },
    });
  }
  for (let attempt = 1; Date.now() < deadline; attempt++) {
    try {
      const instance = await api.get(path, true);
      if (instance && !ACTIVE.has(instance.status)) {
        emit('workflow', 'processor-instance-poll', 'PROCESSOR_CONTROL_POLL', instance.status === 'complete' ? 'OK' : 'FAILED', {
          attempt, actual: instance.status === 'complete' ? 'complete' : 'terminal-or-invalid',
          error_code: instance.status === 'complete' ? undefined : 'PROCESSOR_CONTROL_FAILED',
        });
        return instance;
      }
      emit('workflow', 'processor-instance-poll', 'PROCESSOR_CONTROL_POLL', 'RETRY', { attempt, actual: 'waiting-for-instance' });
    } catch (error) {
      if (!error?.transient) throw error;
      emit('workflow', 'processor-instance-poll', 'PROCESSOR_CONTROL_POLL', 'RETRY', {
        attempt, error_code: 'PROCESSOR_CONTROL_POLL_UNAVAILABLE', details: { http_status: error?.status },
      });
    }
    await wait(2000);
  }
  emit('workflow', 'processor-instance-poll', 'PROCESSOR_CONTROL_POLL', 'NOT_OBSERVED', { error_code: 'PROCESSOR_CONTROL_TIMEOUT' });
  return null;
}

export async function runProcessorSmoke(api, id, version, emit, runtime, { runId, wait = sleep } = {}) {
  const deadline = Date.now() + 60000;
  let ready = false;
  for (let attempt = 1; attempt <= 5 && Date.now() < deadline; attempt++) {
    const readinessId = randomUUID();
    runtime.readinessId = readinessId;
    const instance = await invoke(api, readinessId, { operation: 'processor-ready', runId }, emit,
      Math.min(deadline, Date.now() + 12000), wait);
    const matched = instance?.status === 'complete' && output(instance) === READY + version;
    emit('workflow', 'processor-readiness', 'DEPLOYED_VERSION_CHECK', matched ? 'OK' : 'RETRY', {
      attempt, expected: 'deployed-version', actual: matched ? 'runtime-matched' : 'runtime-unconfirmed',
      error_code: matched ? undefined : 'DEPLOYED_VERSION_NOT_READY',
    });
    if (matched) { ready = true; break; }
    if (attempt < 5) await wait(2000);
  }
  if (!ready) throw new Error('DEPLOYED_VERSION_NOT_READY');
  runtime.started = true;
  let primary;
  try {
    runtime.instance = await invoke(api, id, { operation: 'processor-smoke', jobId: id, expectedVersion: version, runId },
      emit, Date.now() + 130000, wait);
    if (output(runtime.instance) !== 'MIGRATION_PROCESSOR_SMOKE_VERIFIED' || runtime.instance?.status !== 'complete') {
      throw new Error('MIGRATION_PROCESSOR_SMOKE_FAILED');
    }
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      // A timed-out controller can still be writing. Keep its evidence and
      // await a confirmed terminal state before allowing cleanup to touch it.
      if (!runtime.instance || ACTIVE.has(runtime.instance.status)) throw new Error('PROCESSOR_SMOKE_CLEANUP_DEFERRED');
      runtime.cleanupId = randomUUID();
      const cleanup = await invoke(api, runtime.cleanupId, { operation: 'processor-cleanup', targetId: id, runId },
        emit, Date.now() + 40000, wait);
      if (output(cleanup) !== 'MIGRATION_PROCESSOR_CLEANUP_OK' || cleanup?.status !== 'complete') {
        throw new Error('PROCESSOR_SMOKE_CLEANUP_FAILED');
      }
      emit('cleanup', 'processor-smoke-cleanup', 'PROCESSOR_CLEANUP_CONTROL', 'OK');
    } catch (error) {
      const deferred = error?.message === 'PROCESSOR_SMOKE_CLEANUP_DEFERRED';
      emit('cleanup', 'processor-smoke-cleanup', 'PROCESSOR_CLEANUP_CONTROL', deferred ? 'NOT_OBSERVED' : 'FAILED', {
        error_code: deferred ? 'PROCESSOR_SMOKE_CLEANUP_DEFERRED' : 'PROCESSOR_SMOKE_CLEANUP_FAILED',
      });
      if (!primary) throw error;
    }
  }
}
