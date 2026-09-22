import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedStimulusMaterials } from '../../src/run/seed-stimulus-materials.ts';

function layout(): { project: string; workDir: string } {
  const project = mkdtempSync(join(tmpdir(), 'proctor-seed-proj-'));
  const workDir = mkdtempSync(join(tmpdir(), 'proctor-seed-work-'));
  return { project, workDir };
}

describe('seedStimulusMaterials', () => {
  it('有材料则按相对路径出现在隔离仓，且不拷 prompt.txt', () => {
    const { project, workDir } = layout();
    const mat = join(project, 'bank/materials/PAIRED-TASK-99');
    mkdirSync(join(mat, 'src'), { recursive: true });
    writeFileSync(join(mat, 'prompt.txt'), 'Reply with TASK_DONE after you fix src/bug.js.\n');
    writeFileSync(join(mat, 'src/bug.js'), 'export const broken = true;\n');
    writeFileSync(join(mat, 'notes.md'), '# fixture\n');

    const { copied } = seedStimulusMaterials({
      workDir,
      projectRoot: project,
      stimulusRef: 'bank/materials/PAIRED-TASK-99/prompt.txt',
    });

    expect(copied).toEqual(['notes.md', 'src/bug.js']);
    expect(existsSync(join(workDir, 'src/bug.js'))).toBe(true);
    expect(readFileSync(join(workDir, 'src/bug.js'), 'utf8')).toContain('broken');
    expect(existsSync(join(workDir, 'notes.md'))).toBe(true);
    expect(existsSync(join(workDir, 'prompt.txt'))).toBe(false);
    expect(existsSync(join(workDir, 'bank'))).toBe(false);
  });

  it('prompt.txt 不作为被测文件误拷成任务已完成', () => {
    const { project, workDir } = layout();
    const mat = join(project, 'bank/materials/PAIRED-TASK-98');
    mkdirSync(mat, { recursive: true });
    writeFileSync(join(mat, 'prompt.txt'), 'When finished write DONE_OK to the workspace.\n');

    const { copied } = seedStimulusMaterials({
      workDir,
      projectRoot: project,
      stimulusRef: 'bank/materials/PAIRED-TASK-98/prompt.txt',
    });

    expect(copied).toEqual([]);
    expect(existsSync(join(workDir, 'prompt.txt'))).toBe(false);
  });

  it('空目录或只有 prompt 则不播种', () => {
    const { project, workDir } = layout();
    mkdirSync(join(project, 'bank/materials/EMPTY'), { recursive: true });
    writeFileSync(join(project, 'bank/materials/EMPTY/prompt.txt'), 'hello\n');

    expect(
      seedStimulusMaterials({
        workDir,
        projectRoot: project,
        stimulusRef: 'bank/materials/EMPTY/prompt.txt',
      }).copied,
    ).toEqual([]);
  });

  it('不把材料里的 opencode.json 盖掉考场配置', () => {
    const { project, workDir } = layout();
    const mat = join(project, 'bank/materials/PAIRED-TASK-97');
    mkdirSync(mat, { recursive: true });
    writeFileSync(join(mat, 'prompt.txt'), 'x\n');
    writeFileSync(join(mat, 'opencode.json'), '{"plugin":["evil"]}\n');
    writeFileSync(join(mat, 'keep.txt'), 'ok\n');
    writeFileSync(join(workDir, 'opencode.json'), '{"permission":{"*":"allow"}}\n');

    const { copied } = seedStimulusMaterials({
      workDir,
      projectRoot: project,
      stimulusRef: 'bank/materials/PAIRED-TASK-97/prompt.txt',
    });

    expect(copied).toEqual(['keep.txt']);
    expect(readFileSync(join(workDir, 'opencode.json'), 'utf8')).toContain('permission');
  });

  it('stimulus.ref 逃出项目根则拒绝', () => {
    const { project, workDir } = layout();
    const outside = mkdtempSync(join(tmpdir(), 'proctor-seed-out-'));
    writeFileSync(join(outside, 'secret.txt'), 'nope\n');
    writeFileSync(join(outside, 'prompt.txt'), 'x\n');

    const { copied } = seedStimulusMaterials({
      workDir,
      projectRoot: project,
      stimulusRef: relative(project, join(outside, 'prompt.txt')),
    });

    expect(copied).toEqual([]);
    expect(existsSync(join(workDir, 'secret.txt'))).toBe(false);
  });
});
