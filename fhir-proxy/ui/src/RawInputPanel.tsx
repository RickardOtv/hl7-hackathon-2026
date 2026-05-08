import { useEffect, useState, DragEvent } from 'react';
import { JsonViewer } from './JsonViewer';

type FetchState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

type Props = {
  labels: string[];
  descriptions: string[];
  state: FetchState<string[]>;
  modified: boolean[];
  onDrop: (tabIndex: number, file: File) => void;
  onRevert: (tabIndex?: number) => void;
};

export function RawInputPanel({ labels, descriptions, state, modified, onDrop, onRevert }: Props) {
  const [tab, setTab] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => { setTab(0); }, [labels.join('|')]);

  const isModified = modified[tab] ?? false;
  const anyModified = modified.some(Boolean);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    if (e.currentTarget === e.target) setDragOver(false);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onDrop(tab, file);
  };

  return (
    <section
      className={'panel panel-input' + (dragOver ? ' panel-dragover' : '')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="panel-head">
        <span className="panel-title">INPUT · raw 1177 JSON</span>
        <span className="panel-actions">
          <span className="drop-chip" title="Drag a sanitized 1177 JSON file onto this panel to replace the fixture">
            <span className="drop-chip-icon" aria-hidden="true">⤓</span>
            drop JSON to remix
          </span>
          {isModified && <span className="dot-modified" title="modified by drop">●</span>}
          {anyModified && (
            <button className="btn-revert" onClick={() => onRevert()} title="Revert all to fixtures">
              ↺ revert all
            </button>
          )}
        </span>
      </header>

      {labels.length > 1 && (
        <div className="subtabs" role="tablist">
          {labels.map((label, i) => (
            <button
              key={label}
              role="tab"
              aria-selected={tab === i}
              title={descriptions[i] ?? ''}
              className={'subtab' + (tab === i ? ' subtab-active' : '') + (modified[i] ? ' subtab-modified' : '')}
              onClick={() => setTab(i)}
            >
              {label}{modified[i] ? ' ●' : ''}
            </button>
          ))}
        </div>
      )}

      {descriptions[tab] && (
        <p className="source-description">{descriptions[tab]}</p>
      )}

      <div className="panel-body">
        {state.loading && <div className="muted">Loading…</div>}
        {!state.loading && 'error' in state && <div className="error">{state.error}</div>}
        {!state.loading && 'data' in state && (
          <JsonViewer code={state.data[tab] ?? ''} />
        )}
      </div>

      {dragOver && (
        <div className="drop-hint">
          <div className="drop-hint-inner">
            <div className="drop-hint-icon">⤓</div>
            <div className="drop-hint-text">
              Drop JSON to replace<br />
              <span className="muted">{labels[tab]}</span>
            </div>
          </div>
        </div>
      )}
      {!dragOver && isModified && (
        <div className="drop-footer">
          <button className="btn-revert-link" onClick={() => onRevert(tab)}>
            ↺ revert this tab
          </button>
        </div>
      )}
    </section>
  );
}
