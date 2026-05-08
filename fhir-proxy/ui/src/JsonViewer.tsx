import { useEffect, useState } from 'react';
import { createHighlighter, type Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['vesper'],
      langs: ['json'],
    });
  }
  return highlighterPromise;
}

type Props = { code: string };

export function JsonViewer({ code }: Props) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then(h => {
      if (cancelled) return;
      const out = h.codeToHtml(code, {
        lang: 'json',
        theme: 'vesper',
        // Recolor vesper's mint strings to warm gold so the JSON sits inside
        // the fire-orange brand palette. Keys (peach #FFC799) stay as-is.
        colorReplacements: { '#99FFE4': '#FFD27D', '#99ffe4': '#FFD27D' },
      });
      setHtml(out);
    });
    return () => { cancelled = true; };
  }, [code]);

  if (html === null) {
    return <pre className="json-fallback">{code}</pre>;
  }
  return <div className="json-viewer" dangerouslySetInnerHTML={{ __html: html }} />;
}
