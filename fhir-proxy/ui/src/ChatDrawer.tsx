import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

const OLLAMA = 'http://localhost:11434';
// Models that work with tool-calling through Ollama's OpenAI-compat layer.
// gemma3 and deepseek-r1 currently DON'T (Ollama gates tools per model template).
const TOOL_CAPABLE = ['qwen3', 'qwen2.5', 'llama3.2', 'llama3.1', 'llama3', 'mistral', 'command-r'];
// Preference order when auto-picking a default — prefer tool-capable, then anything else.
const PREFERRED = [...TOOL_CAPABLE, 'gemma3'];

type Probe =
  | { state: 'checking' }
  | { state: 'ok'; models: string[]; selected: string }
  | { state: 'no-models' }
  | { state: 'down' };

type ToolCall = {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
};

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
};

type Props = {
  resourceLabel: string;
  fhirJson: string;
};

function pickDefault(models: string[]): string {
  for (const pref of PREFERRED) {
    const hit = models.find(m => m === pref || m.startsWith(`${pref}:`));
    if (hit) return hit;
  }
  return models[0];
}

function isToolCapable(modelName: string): boolean {
  return TOOL_CAPABLE.some(p => modelName === p || modelName.startsWith(`${p}:`));
}

/** FHIR-aware empty-state prompts, varied by which resource is in view. */
function suggestionsFor(resourceLabel: string): string[] {
  const r = resourceLabel.toLowerCase();
  if (r.includes('appointment')) {
    return [
      'When is the next appointment?',
      'Which facility is it at and what is the HSA-ID?',
      'Do I also have any unread inbox messages?',
    ];
  }
  if (r.includes('communication') || r.includes('message')) {
    return [
      'Summarize the inbox in 3 lines.',
      'Which messages are still unread, and from which facility?',
      'Tell me about my next appointment too.',
    ];
  }
  return [
    "What's the patient's personnummer and which OID system identifies it?",
    'What demographics are present and which FHIR fields hold them?',
    'Do I have any upcoming appointments or unread messages?',
  ];
}

/** deepseek-r1 etc. emit <think>...</think> reasoning. Strip closed blocks; suppress open ones. */
function stripThink(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  const openIdx = out.lastIndexOf('<think>');
  if (openIdx !== -1 && out.indexOf('</think>', openIdx) === -1) {
    out = out.slice(0, openIdx);
  }
  return out;
}

export function ChatDrawer({ resourceLabel, fhirJson }: Props) {
  const [open, setOpen] = useState(false);
  const [probe, setProbe] = useState<Probe>({ state: 'checking' });
  const [model, setModel] = useState<string>('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${OLLAMA}/api/tags`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        const names: string[] = (j.models ?? []).map((m: { name: string }) => m.name);
        if (names.length === 0) {
          setProbe({ state: 'no-models' });
          return;
        }
        const selected = pickDefault(names);
        setModel(selected);
        setProbe({ state: 'ok', models: names, selected });
      })
      .catch(() => { if (!cancelled) setProbe({ state: 'down' }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || streaming || !model) return;
    setInput('');
    const userMsg: Msg = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages([...next, { role: 'assistant', content: '', toolCalls: [] }]);
    setStreaming(true);

    // Initial context: tell the agent what the user is currently looking at.
    const system = [
      `The user is currently viewing the following FHIR R4 ${resourceLabel} resource on screen.`,
      `Use this directly when the question is about this resource. For other resources or follow-up details, call the tools.`,
      '',
      '```json',
      fhirJson || '(no resource currently displayed)',
      '```',
    ].join('\n');

    try {
      // Talk directly to the Mastra sidecar. Same machine, permissive CORS, works
      // identically whether the GUI is served by Vite (:5173) or the Spring jar (:8181).
      const res = await fetch('http://localhost:4111/api/agents/fhirAgent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(m => ({ role: m.role, content: m.content })),
          system,
          requestContext: { model },
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Agent ${res.status}: ${await res.text().catch(() => '')}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      const tools: ToolCall[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Mastra emits lines prefixed with "data: {...}".
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          const json = line.startsWith('data:') ? line.slice(5).trim() : line;
          if (!json || json === '[DONE]') continue;
          try {
            const evt: { type?: string; payload?: Record<string, unknown> } = JSON.parse(json);
            if (!evt.type) continue;

            if (evt.type === 'text-delta' && evt.payload) {
              const piece = (evt.payload as { text?: string }).text ?? '';
              if (piece) {
                acc += piece;
                const display = stripThink(acc);
                setMessages(prev => {
                  const copy = prev.slice();
                  copy[copy.length - 1] = { role: 'assistant', content: display, toolCalls: [...tools] };
                  return copy;
                });
              }
            } else if (evt.type === 'tool-call' && evt.payload) {
              const p = evt.payload as { toolCallId: string; toolName: string; args?: unknown };
              tools.push({ toolCallId: p.toolCallId, toolName: p.toolName, args: p.args });
              setMessages(prev => {
                const copy = prev.slice();
                copy[copy.length - 1] = { ...copy[copy.length - 1], toolCalls: [...tools] };
                return copy;
              });
            } else if (evt.type === 'tool-result' && evt.payload) {
              const p = evt.payload as { toolCallId: string; result: unknown; isError?: boolean };
              const t = tools.find(x => x.toolCallId === p.toolCallId);
              if (t) {
                t.result = p.result;
                t.isError = p.isError;
                setMessages(prev => {
                  const copy = prev.slice();
                  copy[copy.length - 1] = { ...copy[copy.length - 1], toolCalls: [...tools] };
                  return copy;
                });
              }
            } else if (evt.type === 'error' && evt.payload) {
              const p = evt.payload as { error?: { message?: string } };
              const msg = p.error?.message ?? 'unknown error';
              setMessages(prev => {
                const copy = prev.slice();
                copy[copy.length - 1] = {
                  ...copy[copy.length - 1],
                  content: (copy[copy.length - 1].content || '') + `\n\n⚠ ${msg}`,
                };
                return copy;
              });
            }
          } catch {
            // ignore unparsable lines
          }
        }
      }
    } catch (e) {
      setMessages(prev => {
        const copy = prev.slice();
        copy[copy.length - 1] = {
          ...copy[copy.length - 1],
          content: `⚠ ${String(e)} — is the agent sidecar running? (\`npm run dev\`)`,
        };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const showCapabilityWarning = probe.state === 'ok' && model && !isToolCapable(model);

  return (
    <aside className={'chat' + (open ? ' chat-open' : '')}>
      <button
        type="button"
        className="chat-head"
        aria-expanded={open}
        aria-controls="chat-body"
        onClick={() => setOpen(o => !o)}
      >
        <svg className="chat-bubble" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M3 3h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 15 13H7l-3.5 3v-3H3a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 3 3z" />
          <circle cx="6" cy="8" r="0.9" />
          <circle cx="9" cy="8" r="0.9" />
          <circle cx="12" cy="8" r="0.9" />
        </svg>
        <span className="chat-title">AI assistant</span>
        <span className="chat-hint">
          {open ? 'click to collapse' : `ask about your ${resourceLabel.toLowerCase()}`}
        </span>
        <span className="chat-meta">
          {probe.state === 'checking' && 'checking Ollama…'}
          {probe.state === 'no-models' && 'no Ollama models installed'}
          {probe.state === 'down' && 'Ollama not detected · localhost:11434'}
        </span>
        <span className="chat-toggle" aria-hidden="true" title={open ? 'Collapse' : 'Expand'}>
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="chat-body" id="chat-body">
          {probe.state === 'down' && (
            <div className="banner">
              Ollama isn't reachable at <code>localhost:11434</code>.<br />
              If it's running, restart it with <code>OLLAMA_ORIGINS='*' ollama serve</code>.
            </div>
          )}
          {probe.state === 'no-models' && (
            <div className="banner">
              Ollama is up, but no models are pulled. Try <code>ollama pull qwen3:4b</code>{' '}
              (small + tool-capable, recommended for this agent).
            </div>
          )}
          {showCapabilityWarning && (
            <div className="banner">
              ⚠ <code>{model}</code> doesn't support tools through Ollama. The agent will fail.
              Try <code>qwen3:4b</code>, <code>llama3.2:3b</code>, or another tool-capable model
              from the dropdown.
            </div>
          )}
          {probe.state === 'ok' && probe.models.length >= 1 && (
            <div className="model-row">
              <label>Model:</label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                disabled={streaming}
              >
                {probe.models.map(m => (
                  <option key={m} value={m}>
                    {m}{isToolCapable(m) ? '' : ' · no tools'}
                  </option>
                ))}
              </select>
              <a className="playground-link" href="http://localhost:4111" target="_blank" rel="noopener">
                agent playground ↗
              </a>
              <button
                type="button"
                className="chat-clear"
                onClick={() => {
                  if (window.confirm('Clear all chat messages? This cannot be undone.')) {
                    setMessages([]);
                  }
                }}
                disabled={streaming || messages.length === 0}
                title="Remove all messages from this conversation"
              >
                Clear chat
              </button>
            </div>
          )}

          <div className="chat-messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="suggestion-row">
                {suggestionsFor(resourceLabel).map(s => (
                  <button key={s} type="button" className="suggestion" onClick={() => setInput(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const isLoading = streaming && isLast && !m.content;
              return (
                <div key={i} className={'msg msg-' + m.role}>
                  <span className="msg-role">{m.role === 'user' ? 'you' : model}</span>
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <ToolTrace calls={m.toolCalls} />
                  )}
                  <div className="msg-text">
                    {m.role === 'assistant' && m.content ? (
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    ) : isLoading ? (
                      <LoadingIndicator toolCalls={m.toolCalls} />
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="chat-input-row">
            <textarea
              className="chat-input"
              placeholder="Ask a question about this FHIR resource…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={2}
              disabled={streaming}
            />
            <button className="chat-send" onClick={send} disabled={streaming || !input.trim()}>
              {streaming ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function LoadingIndicator({ toolCalls }: { toolCalls?: ToolCall[] }) {
  const inflight = toolCalls?.find(t => t.result === undefined && !t.isError);
  const finishedCount = toolCalls?.filter(t => t.result !== undefined).length ?? 0;
  const label = inflight
    ? `calling ${inflight.toolName}…`
    : finishedCount > 0
      ? 'reading results…'
      : 'thinking…';
  return (
    <span className="chat-loading" aria-live="polite">
      <span className="chat-loading-dots" aria-hidden="true">
        <span /><span /><span />
      </span>
      <span className="chat-loading-label">{label}</span>
    </span>
  );
}

function ToolTrace({ calls }: { calls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);
  const summary = calls.map(c => c.toolName).join(' · ');
  return (
    <div className="tool-trace">
      <button className="tool-trace-toggle" onClick={() => setExpanded(e => !e)}>
        🔧 used tool{calls.length > 1 ? 's' : ''}: {summary} {expanded ? '▾' : '▸'}
      </button>
      {expanded && (
        <div className="tool-trace-detail">
          {calls.map(c => (
            <div key={c.toolCallId} className="tool-call">
              <div className="tool-call-name">
                {c.toolName}
                {c.isError && <span className="tool-call-err"> · error</span>}
              </div>
              {c.args !== undefined && Object.keys(c.args as object).length > 0 && (
                <div className="tool-call-args">
                  args: <code>{JSON.stringify(c.args)}</code>
                </div>
              )}
              {c.result !== undefined && (
                <div className="tool-call-result">
                  result: <code>{summarizeResult(c.result)}</code>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summarizeResult(r: unknown): string {
  if (typeof r === 'string') return r.length > 120 ? r.slice(0, 120) + '…' : r;
  if (r && typeof r === 'object') {
    const obj = r as Record<string, unknown>;
    if (obj.resourceType === 'Bundle' && Array.isArray(obj.entry)) {
      return `Bundle (${obj.entry.length} entries)`;
    }
    if (typeof obj.resourceType === 'string') return `${obj.resourceType} resource`;
    const json = JSON.stringify(r);
    return json.length > 120 ? json.slice(0, 120) + '…' : json;
  }
  return String(r);
}
