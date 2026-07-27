import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadJournal, sealJournalToManifestFields } from '../../src/drivers/cassette/journal.ts';

describe('cassette journal', () => {
  it('seal 压缩 hook/事件子序列', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jnl-'));
    const file = join(dir, 'journal.ndjson');
    writeFileSync(
      file,
      [
        JSON.stringify({
          hook: 'event',
          payload: { event: { type: 'session.idle' } },
        }),
        JSON.stringify({ hook: 'chat.message', payload: { sessionID: 's' } }),
        JSON.stringify({
          hook: 'event',
          payload: { event: { type: 'session.idle' } },
        }),
      ].join('\n') + '\n',
    );
    const entries = loadJournal(dir, 'journal.ndjson');
    const sealed = sealJournalToManifestFields(entries);
    expect(sealed.expected_hooks).toEqual(['event', 'chat.message', 'event']);
    expect(sealed.expected_events).toEqual(['session.idle']);
  });

  it('recorder-plugin 可 import 且写出 journal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const journal = join(dir, 'journal.ndjson');
    process.env.PROCTOR_CASSETTE_JOURNAL = journal;
    process.env.PROCTOR_CASSETTE_ID = 't';
    const mod = await import(
      pathToFileURL(join(process.cwd(), 'src/drivers/cassette/recorder-plugin.mjs')).href
    );
    const hooks = mod.plugin({});
    await hooks.event({ event: { type: 'session.created' } });
    await hooks['chat.message']({ sessionID: 'x' });
    const entries = loadJournal(dir, 'journal.ndjson');
    expect(entries.map((e) => e.hook)).toEqual(['event', 'chat.message']);
    delete process.env.PROCTOR_CASSETTE_JOURNAL;
    delete process.env.PROCTOR_CASSETTE_ID;
  });
});
