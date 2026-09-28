import { expect, test } from 'bun:test';
import { suggestCatalog } from '../../src/catalog/classify';
import { LlmError, type LlmProvider, type LlmRequest } from '../../src/llm/types';
import type { ChapterNote } from '../../src/types';

const notes: readonly ChapterNote[] = [{
  idx: 1, title: 'Thinking clearly', gist: 'How cognitive biases distort decisions.',
  keyPoints: [], quotes: [],
}];

function fakeProvider(reply: unknown, inspect?: (request: LlmRequest) => void): LlmProvider {
  return {
    name: 'fake', suggestedConcurrency: 1, overheadTokens: 0,
    async complete(request) {
      inspect?.(request);
      return JSON.stringify(reply);
    },
  };
}

test('suggests normalized category and tags through one structured catalog call', async () => {
  const result = await suggestCatalog('Thinking', notes, fakeProvider({
    category: 'Psychology', tags: ['Bias', 'bias', 'Decision making'],
  }, (request) => {
    expect(request.label).toBe('catalog');
    expect(request.schema).toMatchObject({
      type: 'object', required: ['category', 'tags'], additionalProperties: false,
      properties: { tags: { minItems: 1, maxItems: 6 } },
    });
    expect(request.system).toContain('English');
    expect(request.prompt).toContain('Thinking clearly');
  }), undefined, 'en');

  expect(result).toEqual({ category: 'Psychology', tags: ['Bias', 'Decision making'] });
});

test('normalizes overlong catalog values', async () => {
  const result = await suggestCatalog('Thinking', notes, fakeProvider({
    category: `  ${'c'.repeat(90)}  `,
    tags: [` ${'t'.repeat(90)} `],
  }));

  expect(result).toEqual({ category: 'c'.repeat(80), tags: ['t'.repeat(80)] });
});

test('rejects malformed model output and an empty normalized category', async () => {
  const malformed: LlmProvider = {
    name: 'fake', suggestedConcurrency: 1, overheadTokens: 0,
    async complete() { return '{not JSON'; },
  };

  await expect(suggestCatalog('Thinking', notes, malformed)).rejects.toMatchObject({ code: 'bad_output' });
  await expect(suggestCatalog('Thinking', notes, fakeProvider({
    category: '   ', tags: ['Bias'],
  }))).rejects.toBeInstanceOf(LlmError);
});
