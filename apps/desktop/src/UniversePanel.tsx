import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { BookUniverse, RelatedBook, UniverseEvidence, UniverseRole } from '@cairn/core/universe/types';
import { Link, useT } from '@cairn/ui';
import type { UniverseChange } from './shared/schema';

export type UniversePanelState =
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'building'; readonly universe?: BookUniverse }
  | { readonly status: 'failed'; readonly message: string; readonly universe?: BookUniverse }
  | { readonly status: 'ready'; readonly universe: BookUniverse };

interface UniversePanelProps {
  readonly section: 'universe' | 'experts' | 'evidence';
  readonly state: UniversePanelState;
  readonly onBuild: () => void | Promise<void>;
  readonly onPatch: (change: UniverseChange) => void | Promise<void>;
}

const ROLES: readonly UniverseRole[] = ['foundation', 'support', 'oppose', 'verify', 'apply', 'extend'];

const universeOf = (state: UniversePanelState): BookUniverse | undefined =>
  'universe' in state ? state.universe : undefined;

export function UniversePanel({ section, state, onBuild, onPatch }: UniversePanelProps): ReactElement {
  const t = useT();
  const universe = universeOf(state);
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<UniverseRole>('support');
  const title = useRef<HTMLInputElement>(null);
  const authors = useRef<HTMLInputElement>(null);

  if (state.status === 'loading') {
    return <div className="universe-status" role="status">{t.details.universe.loading}</div>;
  }

  if (state.status === 'empty') {
    return (
      <div className="universe-empty" role="tabpanel">
        <h3>{t.details.universe.privacyTitle}</h3>
        <p>{t.details.universe.privacy}</p>
        <button type="button" className="shelf-act primary" onClick={() => onBuild()}>
          {t.details.universe.build}
        </button>
      </div>
    );
  }

  const action = state.status === 'failed' ? t.details.universe.retry : t.details.universe.refresh;
  return (
    <div className="universe-panel" role="tabpanel">
      {state.status === 'building' && (
        <div className="universe-status" role="status">{t.details.universe.building}</div>
      )}
      {state.status === 'failed' && (
        <div className="universe-error" role="alert">{state.message}</div>
      )}

      {universe && section === 'universe' && (
        <UniverseList universe={universe} onPatch={onPatch} />
      )}
      {universe && section === 'experts' && <ExpertList universe={universe} />}
      {universe && section === 'evidence' && <EvidenceList universe={universe} />}

      {state.status !== 'building' && (
        <div className="universe-actions">
          <button type="button" className="shelf-act" onClick={() => onBuild()}>{action}</button>
          {section === 'universe' && universe && (
            <button type="button" className="shelf-act" onClick={() => setAdding((value) => !value)}>
              {t.details.universe.addManual}
            </button>
          )}
        </div>
      )}

      {adding && section === 'universe' && (
        <div className="universe-manual">
          <label>
            <span>{t.details.universe.bookTitle}</span>
            <input ref={title} aria-label={t.details.universe.bookTitle} />
          </label>
          <label>
            <span>{t.details.universe.authors}</span>
            <input ref={authors} aria-label={t.details.universe.authors} />
          </label>
          <label>
            <span>{t.details.universe.relationship}</span>
            <select value={role} onChange={(event) => setRole(event.target.value as UniverseRole)}>
              {ROLES.map((value) => <option key={value} value={value}>{t.details.universe.roles[value]}</option>)}
            </select>
          </label>
          <button type="button" className="shelf-act primary"
            onClick={() => {
              const nextTitle = title.current?.value.trim() ?? '';
              if (!nextTitle) return;
              const nextAuthors = (authors.current?.value ?? '')
                .split(',').map((author) => author.trim()).filter(Boolean);
              void onPatch({ type: 'add', title: nextTitle, authors: nextAuthors, role });
              setAdding(false);
            }}>
            {t.details.universe.addCandidate}
          </button>
        </div>
      )}
    </div>
  );
}

function UniverseList({ universe, onPatch }: {
  readonly universe: BookUniverse;
  readonly onPatch: (change: UniverseChange) => void | Promise<void>;
}): ReactElement {
  const t = useT();
  return (
    <>
      {universe.books.length < 5 && <p className="universe-honest">{t.details.universe.fewer}</p>}
      <div className="universe-groups" aria-label={t.details.universe.groupedBooks}>
        {ROLES.map((role) => {
          const books = universe.books.filter((book) => book.role === role);
          if (books.length === 0) return null;
          return (
            <section className="universe-group" key={role}>
              <h3>{t.details.universe.roles[role]}</h3>
              <ul>{books.map((book) => (
                <li key={book.id}>
                  <BookCard book={book} />
                  <div className="universe-card-actions">
                    <label>
                      <span className="sr-only">{t.details.universe.relationshipFor(book.title)}</span>
                      <select aria-label={t.details.universe.relationshipFor(book.title)} value={book.role}
                        onChange={(event) => onPatch({
                          type: 'setRole', id: book.id, role: event.target.value as UniverseRole,
                        })}>
                        {ROLES.map((value) => (
                          <option key={value} value={value}>{t.details.universe.roles[value]}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={() => onPatch({ type: 'dismiss', id: book.id })}
                      aria-label={t.details.universe.dismissBook(book.title)}>
                      {t.details.universe.dismissBook(book.title)}
                    </button>
                  </div>
                </li>
              ))}</ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function ExpertList({ universe }: { readonly universe: BookUniverse }): ReactElement {
  const t = useT();
  const experts = universe.books.filter((book) =>
    book.linkedBookId !== undefined && (book.evidence === 'mapped' || book.evidence === 'finished'));
  if (experts.length === 0) return <p className="universe-status">{t.details.universe.noExperts}</p>;
  return (
    <ul className="universe-experts">
      {experts.map((book) => <li key={book.id}><BookCard book={book} /></li>)}
    </ul>
  );
}

function EvidenceList({ universe }: { readonly universe: BookUniverse }): ReactElement {
  const t = useT();
  return (
    <>
      <p className="universe-verified">{t.details.universe.lastVerified(formatDate(universe.generatedAt))}</p>
      <ul className="universe-evidence">
        {universe.books.map((book) => <li key={book.id}><BookCard book={book} /></li>)}
      </ul>
    </>
  );
}

function BookCard({ book }: { readonly book: RelatedBook }): ReactElement {
  const t = useT();
  return (
    <article className="universe-card">
      <div className="universe-card-head">
        <strong>{book.title}</strong>
        <span className={`universe-badge ${book.evidence}`}>{evidenceLabel(book.evidence, t)}</span>
      </div>
      {book.authors.length > 0 && <p>{book.authors.join(', ')}</p>}
      {book.origin === 'generated' && <p>{book.rationale}</p>}
      {book.sources.length > 0 && (
        <ul className="universe-sources">
          {book.sources.map((source) => (
            <li key={source.url}><Link href={source.url}>{source.title}</Link></li>
          ))}
        </ul>
      )}
    </article>
  );
}

function evidenceLabel(evidence: UniverseEvidence, t: ReturnType<typeof useT>): string {
  return evidence === 'imported'
    ? `${t.details.universe.evidence.imported} · ${t.details.universe.evidence.preparing}`
    : t.details.universe.evidence[evidence];
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString();
}
