import { describe, expect, it } from 'vitest';
import {
  MODULE_TOO_LONG,
  graphemeLength,
  graphemeSlice,
  moduleLength,
  moduleText,
} from '../src/m3.js';

describe('DEF-010: Module length in user-visible characters', () => {
  it('counts an emoji (even a multi-code-point one) as 1', () => {
    expect(graphemeLength('abc')).toBe(3);
    expect(graphemeLength('👨‍👩‍👧')).toBe(1);
    expect(graphemeLength('🇵🇭é')).toBe(2);
    expect(moduleLength('  ✅ Done  ')).toBe(6);
    expect(graphemeSlice('👨‍👩‍👧ab', 2)).toBe('👨‍👩‍👧a');
  });
  it('the schema allows 100 and refuses 101', () => {
    expect(moduleText.safeParse('🙂'.repeat(100)).success).toBe(true);
    const r = moduleText.safeParse('🙂'.repeat(101));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(MODULE_TOO_LONG);
    expect(moduleText.parse('   ')).toBeNull();
  });
});
