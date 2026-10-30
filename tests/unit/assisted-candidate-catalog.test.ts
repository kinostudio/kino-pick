import { describe, expect, it } from 'vitest';
import { assistedCandidatePageSchema } from '../../packages/contracts/src/assisted-candidate-catalog';

const scope = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  albumId: '33333333-3333-4333-8333-333333333333',
  projectRevision: 2,
  albumRevision: 1,
  changeSequence: 0,
};

function candidate(index: number) {
  return {
    photoId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    filename: `photo-${index}.jpg`,
    currentVersionId: `99999999-9999-4999-8999-${String(index).padStart(12, '0')}`,
    revision: 0,
  };
}

describe('Assisted candidate catalog page contract', () => {
  it('accepts a scoped bounded page with nullable next cursor', () => {
    const page = {
      ...scope,
      items: [
        candidate(1),
        { ...candidate(2), currentVersionId: null, revision: null },
      ],
      nextCursor: null,
    };

    expect(assistedCandidatePageSchema.parse(page)).toEqual(page);
  });

  it('caps pages at 24 resolved candidates', () => {
    expect(
      assistedCandidatePageSchema.safeParse({
        ...scope,
        items: Array.from({ length: 25 }, (_, index) => candidate(index + 1)),
        nextCursor: 'opaque-signed-cursor',
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      'extra page field',
      { ...scope, items: [], nextCursor: null, secret: 'private' },
    ],
    [
      'extra candidate field',
      {
        ...scope,
        items: [{ ...candidate(1), sha256: 'a'.repeat(64) }],
        nextCursor: null,
      },
    ],
    [
      'invalid workspace UUID',
      {
        ...scope,
        workspaceId: 'not-a-uuid',
        items: [],
        nextCursor: null,
      },
    ],
    [
      'zero project revision',
      {
        ...scope,
        projectRevision: 0,
        items: [],
        nextCursor: null,
      },
    ],
    [
      'negative catalog sequence',
      {
        ...scope,
        changeSequence: -1,
        items: [],
        nextCursor: null,
      },
    ],
    [
      'unsafe catalog sequence',
      {
        ...scope,
        changeSequence: Number.MAX_SAFE_INTEGER + 1,
        items: [],
        nextCursor: null,
      },
    ],
    [
      'empty nonterminal cursor',
      {
        ...scope,
        items: [],
        nextCursor: '',
      },
    ],
    [
      'negative candidate revision',
      {
        ...scope,
        items: [{ ...candidate(1), revision: -1 }],
        nextCursor: null,
      },
    ],
  ])('rejects %s', (_label, page) => {
    expect(assistedCandidatePageSchema.safeParse(page).success).toBe(false);
  });
});
