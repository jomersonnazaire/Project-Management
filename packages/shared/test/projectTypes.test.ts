import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_TYPES,
  createProjectSchema,
  projectTypeHint,
  projectTypeNameKey,
  projectTypeSchema,
} from '../src/index.js';

describe('Project types (doc 14 FR-PTY-01/02)', () => {
  it('names are trimmed, whitespace-collapsed, 1..50 characters', () => {
    expect(projectTypeSchema.parse({ name: '  Hyper   care ' }).name).toBe('Hyper care');
    const blank = projectTypeSchema.safeParse({ name: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error?.issues[0]?.message).toBe('Add a name.');
    expect(projectTypeSchema.safeParse({ name: 'x'.repeat(50) }).success).toBe(true);
    const long = projectTypeSchema.safeParse({ name: 'x'.repeat(51) });
    expect(long.error?.issues[0]?.message).toBe('Keep the name under 50 characters.');
    expect(projectTypeNameKey(' Legacy   (EXAMPLE) ')).toBe('legacy (example)');
  });

  it('seeds nine types without "Legacy (example)"; the hint reads as in the mockup', () => {
    expect(DEFAULT_PROJECT_TYPES).toHaveLength(9);
    expect(DEFAULT_PROJECT_TYPES.some((t) => /legacy/i.test(t.name))).toBe(false);
    expect(projectTypeHint('Implementation')).toBe(
      'From project type: Implementation. You can change it.',
    );
  });

  it('a new project requires a project type', () => {
    const r = createProjectSchema.safeParse({
      name: 'X',
      clientId: 'a'.repeat(24),
      managerId: 'b'.repeat(24),
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      templateId: 'c'.repeat(24),
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path[0] === 'projectTypeId')?.message).toBe(
      'Choose a project type.',
    );
  });
});
