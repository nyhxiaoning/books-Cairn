import type { Citation, EvidenceRecord, SourceRef } from './types';

export class CitationError extends Error {
  constructor(readonly code: 'span' | 'result' | 'source' | 'reference') {
    super(code);
    this.name = 'CitationError';
  }
}

function sameRef(left: SourceRef, right: SourceRef): boolean {
  if ('nodeId' in left || 'bookId' in left) return linkedRef(left, right);
  if ('chapter' in left) {
    return 'chapter' in right && left.chapter === right.chapter && left.title === right.title;
  }
  if ('url' in left) {
    return 'url' in right && left.url === right.url && left.title === right.title;
  }
  return false;
}

function linkedRef(
  left: Extract<SourceRef, { bookId: string }>,
  right: SourceRef,
): boolean {
  if ('nodeId' in left) {
    return 'nodeId' in right && left.bookId === right.bookId && left.nodeId === right.nodeId
      && left.bookTitle === right.bookTitle && left.nodeTitle === right.nodeTitle;
  }
  return 'chapter' in right && 'bookTitle' in right && left.bookId === right.bookId
    && left.chapter === right.chapter && left.bookTitle === right.bookTitle && left.title === right.title;
}

export function validateCitations(
  text: string,
  citations: readonly Citation[],
  evidence: readonly EvidenceRecord[],
): readonly Citation[] {
  for (const citation of citations) {
    const [start, end] = citation.span;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
      throw new CitationError('span');
    }
    const result = evidence.find((item) => item.resultId === citation.resultId);
    if (!result) throw new CitationError('result');
    if (result.source !== citation.source) throw new CitationError('source');
    if (!result.refs.some((ref) => sameRef(ref, citation.ref))) throw new CitationError('reference');
  }
  return citations;
}
