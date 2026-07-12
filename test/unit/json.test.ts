import { describe, expect, it } from 'vitest';
import { extractLastJsonBlock } from '../../src/util/json.js';

describe('extractLastJsonBlock', () => {
  it('parses bare object', () => {
    expect(extractLastJsonBlock('{"verdict":"pass","failedCriteria":[],"summary":"ok"}')).toEqual({
      verdict: 'pass',
      failedCriteria: [],
      summary: 'ok',
    });
  });

  it('takes the LAST object when several exist', () => {
    const text = 'first {"a":1} then finally\n{"verdict":"fail","failedCriteria":["AC2"],"summary":"x"}';
    expect(extractLastJsonBlock(text)).toEqual({ verdict: 'fail', failedCriteria: ['AC2'], summary: 'x' });
  });

  it('handles fenced json block with trailing prose', () => {
    const text = 'Here is my verdict:\n```json\n{"verdict":"pass","failedCriteria":[],"summary":"done"}\n```\nHope that helps!';
    expect(extractLastJsonBlock(text)).toMatchObject({ verdict: 'pass' });
  });

  it('handles braces inside strings', () => {
    const text = '{"summary":"code uses {curly} braces","verdict":"pass","failedCriteria":[]}';
    expect(extractLastJsonBlock(text)).toMatchObject({ summary: 'code uses {curly} braces' });
  });

  it('returns null on garbage', () => {
    expect(extractLastJsonBlock('no json here { broken')).toBeNull();
    expect(extractLastJsonBlock('')).toBeNull();
  });

  it('skips invalid candidates and falls back to earlier valid one', () => {
    const text = '{"valid":true} trailing {not: json}';
    expect(extractLastJsonBlock(text)).toEqual({ valid: true });
  });
});
