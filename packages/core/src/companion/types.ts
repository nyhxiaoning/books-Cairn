export interface ChapterRef {
  readonly chapter: number;
  readonly title: string;
}

export interface WebRef {
  readonly url: string;
  readonly title: string;
}

export interface ShelfRef {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly nodeId: string;
  readonly nodeTitle: string;
}

export interface ExpertRef {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly chapter: number;
  readonly title: string;
}

export type Source = 'book' | 'web' | 'shelf' | 'expert';
export type SourceRef = ChapterRef | WebRef | ShelfRef | ExpertRef;

export interface EvidenceRecord {
  readonly resultId: string;
  readonly source: Source;
  readonly refs: readonly SourceRef[];
}

export interface Citation {
  readonly span: readonly [number, number];
  readonly source: Source;
  readonly resultId: string;
  readonly ref: SourceRef;
}

export type ChatMessage =
  | { readonly id: string; readonly role: 'user'; readonly text: string; readonly at: string; readonly selection?: string; readonly atNode?: string }
  | { readonly id: string; readonly role: 'assistant'; readonly text: string; readonly at: string; readonly citations: readonly Citation[]; readonly options?: readonly string[] }
  | { readonly id: string; readonly role: 'tool'; readonly text: string; readonly at: string; readonly name: string; readonly resultId: string };

export interface ChatSession {
  readonly pathGeneratedAt: string;
  readonly messages: readonly ChatMessage[];
  readonly evidence: readonly EvidenceRecord[];
}
