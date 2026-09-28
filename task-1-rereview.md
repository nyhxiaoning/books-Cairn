# Task 1 re-review

## Verdict

APPROVED

## Scope checked

- `packages/core/src/universe/identity.ts`: the normalization change no longer strips
  symbols wholesale. `C`, `C++`, and `C#` produce distinct fallback identities, while
  whitespace and punctuation normalization remains intact. The added regression test covers
  all three cases.
- `packages/core/src/universe/types.ts`: `imported`, `mapped`, and `finished` evidence
  now requires `linkedBookId`; when present, the id must still satisfy `isBookId`. This
  prevents local-state claims from being persisted without a shelf-book link. The added
  parser test covers each affected evidence state.

Focused universe tests pass: 14 passed, 0 failed.
