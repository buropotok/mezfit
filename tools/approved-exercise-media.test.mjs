import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
async function file(path) {
  return readFile(new URL(path, root), 'utf8');
}

describe('approved GIF media release cannot silently drift', () => {
  it('has one immutable 40-character Git commit used for the 1324 verified GIFs', async () => {
    const config = JSON.parse(await file('shared/approved-exercise-media.json'));
    expect(config).toEqual({
      datasetGitRevision: '7455efae41b330c265e7cd4b78dfa848e7ce5ebd',
    });
  });

  it('requires checkout of the approved revision, not the upstream HEAD, before import', async () => {
    const script = await file('tools/import-full-exercise-dataset.mjs');
    expect(script).toContain("new URL('../shared/approved-exercise-media.json',import.meta.url)");
    expect(script).toContain("await run('git',['-C',DIR,'checkout','--detach',approvedRevision])");
    expect(script).toContain("if(importId!==approvedRevision)");
    expect(script).not.toContain("['clone','--depth','1'");
  });

  it('never reruns the privileged R2/D1 media import on app deployment', async () => {
    const workflow = await file('.github/workflows/import-exercise-media.yml');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+workflow_run:/m);
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain("github.actor == github.repository_owner");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("inputs.confirmation == 'IMPORT_PINNED_1324'");
  });
});
