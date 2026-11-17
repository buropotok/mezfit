import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { queueConfigurationDifferences } from './cloudflare.mjs';

const wrangler = JSON.parse(readFileSync(new URL('./wrangler.json', import.meta.url), 'utf8'));
const settings = { batch_size: 10, max_wait_time_ms: 5000, max_retries: 5, retry_delay: 10 };
const worker = 'mezfit-migration';
const consumer = { type: 'worker', script_name: worker, settings };
const workerProducer = { type: 'worker', script: worker };
const r2Producer = { type: 'r2_bucket', bucket_name: 'mezfit-migration-uploads' };
const queue = { consumers: [consumer], producers: [workerProducer, r2Producer] };

describe('migration Queue readback', () => {
  it('accepts the documented REST response and checks Wrangler units', () => {
    const [config] = wrangler.queues.consumers;
    expect(settings).toEqual({
      batch_size: config.max_batch_size,
      max_wait_time_ms: config.max_batch_timeout * 1000,
      max_retries: config.max_retries,
      retry_delay: config.retry_delay,
    });
    expect(queueConfigurationDifferences(queue, true)).toEqual([]);
  });

  it('accepts the direct script identity returned to Wrangler and omitted batch defaults', () => {
    expect(queueConfigurationDifferences({
      ...queue,
      consumers: [{
        type: 'worker', script: worker, dead_letter_queue: '',
        settings: { max_retries: 5, retry_delay: 10, max_concurrency: null },
      }],
      settings: { delivery_paused: false, delivery_delay: 0 },
    }, true)).toEqual([]);
  });

  it('accepts the production service identity returned to Wrangler', () => {
    const identity = { type: 'worker', service: worker, environment: 'production' };
    expect(queueConfigurationDifferences({
      consumers: [{ ...identity, settings }], producers: [r2Producer, identity],
    }, true)).toEqual([]);
  });

  it('allows bootstrap inspection before a consumer has been deployed', () => {
    const pendingQueue = { consumers: [], producers: [r2Producer] };
    expect(queueConfigurationDifferences(pendingQueue)).toEqual([]);
    expect(queueConfigurationDifferences(pendingQueue, true)).toEqual([
      'consumers.length (expected 1 after deploy, got 0)',
    ]);
  });

  it('reports all numeric settings that differ and keeps units distinct', () => {
    expect(queueConfigurationDifferences({
      ...queue,
      consumers: [{
        ...consumer,
        settings: { batch_size: 20, max_wait_time_ms: 5, max_retries: 3, retry_delay: 10000, max_concurrency: 2 },
      }],
    })).toEqual([
      'consumers[0].settings.max_concurrency (expected automatic, got 2)',
      'consumers[0].settings.batch_size (expected 10, got 20)',
      'consumers[0].settings.max_wait_time_ms (expected 5000, got 5)',
      'consumers[0].settings.max_retries (expected 5, got 3)',
      'consumers[0].settings.retry_delay (expected 10, got 10000)',
    ]);
  });

  it('requires the retry settings that differ from default behavior', () => {
    expect(queueConfigurationDifferences({ consumers: [{ ...consumer, settings: {} }] })).toEqual([
      'consumers[0].settings.max_retries (expected 5, got 3)',
      'consumers[0].settings.retry_delay (expected 10, got unset)',
    ]);
  });

  it.each([
    ['HTTP consumer', { consumers: [{ ...consumer, type: 'http_pull' }] }, 'consumers[0].type'],
    ['different script', { consumers: [{ ...consumer, script_name: 'foreign-value' }] }, 'consumers[0].script_name'],
    ['conflicting aliases', { consumers: [{ ...consumer, script: 'foreign-value' }] }, 'consumers[0].script_name'],
    ['non-production service', { consumers: [{ ...consumer, service: worker, environment: 'foreign-value' }] }, 'consumers[0].environment'],
    ['namespaced worker', { consumers: [{ ...consumer, namespace: 'foreign-value' }] }, 'consumers[0].namespace'],
    ['dead-letter queue', { consumers: [{ ...consumer, dead_letter_queue: 'foreign-value' }] }, 'consumers[0].dead_letter_queue'],
    ['extra consumer', { consumers: [consumer, consumer] }, 'consumers.length'],
    ['third-party producer', { producers: [...queue.producers, { ...workerProducer, script: 'foreign-value' }] }, 'producers[2].script'],
    ['different R2 bucket', { producers: [{ ...r2Producer, bucket_name: 'foreign-value' }] }, 'producers[0].bucket_name'],
    ['unknown producer type', { producers: [{ type: 'foreign-value' }] }, 'producers[0].type'],
    ['paused delivery', { settings: { delivery_paused: true } }, 'settings.delivery_paused'],
    ['delivery delay', { settings: { delivery_delay: 10 } }, 'settings.delivery_delay'],
    ['untyped timeout', { consumers: [{ ...consumer, settings: { ...settings, max_wait_time_ms: 'foreign-value' } }] }, 'consumers[0].settings.max_wait_time_ms'],
  ])('reports %s without logging untrusted values', (_name, change, field) => {
    const diagnostic = queueConfigurationDifferences({ ...queue, ...change }).join(', ');

    expect(diagnostic).toContain(field);
    expect(diagnostic).not.toContain('foreign-value');
  });
});
