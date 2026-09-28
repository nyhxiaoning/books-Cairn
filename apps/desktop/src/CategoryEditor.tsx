import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { normalizeCatalogCategory, normalizeCatalogTags, type CatalogPatch, type CatalogRecord } from '@cairn/core/catalog/types';
import { payloadOf } from '@cairn/core/errors';
import { errorText, useT } from '@cairn/ui';

type Suggestion = Pick<CatalogRecord, 'category' | 'tags'>;

export function CategoryEditor({ record, onSave, onSuggest, onClose }: {
  record?: CatalogRecord;
  onSave: (patch: CatalogPatch) => Promise<void> | void;
  onSuggest: () => Promise<Suggestion | undefined>;
  onClose?: () => void;
}): ReactElement {
  const t = useT();
  const category = useRef<HTMLInputElement>(null);
  const [categoryValue, setCategoryValue] = useState(record?.category ?? '');
  const [tagsValue, setTagsValue] = useState(record?.tags.join(', ') ?? '');
  const [busy, setBusy] = useState<'save' | 'suggest'>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => { category.current?.focus(); }, []);

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy('save');
    setFailure(undefined);
    try {
      await onSave({
        category: normalizeCatalogCategory(categoryValue) ?? '',
        tags: normalizeCatalogTags(tagsValue.split(',')),
        source: 'manual',
      });
    } catch (cause) {
      setFailure(errorText(payloadOf(cause), t));
    } finally {
      setBusy(undefined);
    }
  };

  const suggest = async (): Promise<void> => {
    setBusy('suggest');
    setFailure(undefined);
    try {
      const next = await onSuggest();
      if (!next) return;
      setCategoryValue(next.category ?? '');
      setTagsValue(next.tags.join(', '));
    } catch (cause) {
      setFailure(errorText(payloadOf(cause), t));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <form className="modal category-editor" role="dialog" aria-modal="true" onSubmit={(event) => void save(event)} onClick={(event) => event.stopPropagation()}>
        <div className="details-title-row">
          <h2>{t.details.editCatalog}</h2>
          {onClose && <button type="button" className="details-close" onClick={onClose} aria-label={t.details.close}>{t.details.close}</button>}
        </div>
        <label className="catalog-field">
          <span>{t.details.category}</span>
          <input ref={category} value={categoryValue} onInput={(event) => setCategoryValue(event.currentTarget.value)} aria-label={t.details.category} />
        </label>
        <label className="catalog-field">
          <span>{t.details.tags}</span>
          <input value={tagsValue} onInput={(event) => setTagsValue(event.currentTarget.value)} aria-label={t.details.tags} />
          <small>{t.details.tagsHint}</small>
        </label>
        {failure && <p className="modal-error" role="alert">{failure}</p>}
        <div className="details-actions">
          <button type="button" className="ghost details-suggest" disabled={busy !== undefined} onClick={() => void suggest()}>
            {busy === 'suggest' ? t.details.suggesting : t.details.suggest}
          </button>
          <button type="submit" className="primary" disabled={busy !== undefined}>
            {busy === 'save' ? t.details.saving : t.details.save}
          </button>
        </div>
      </form>
    </div>
  );
}
