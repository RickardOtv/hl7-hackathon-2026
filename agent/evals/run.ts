/**
 * Run the eval set against the running agent sidecar.
 *
 *   npm run eval                           # uses default model from agent
 *   EVAL_MODEL=qwen3:4b npm run eval       # pin a model
 *   EVAL_AGENT=http://localhost:4111 npm run eval
 *
 * Streams the agent's response per case, accumulates the final text, scores it
 * with three lightweight metrics, and dumps a JSON report under eval-results/.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { CASES, type EvalCase } from './fixtures.ts';

const AGENT_BASE = process.env.EVAL_AGENT ?? 'http://localhost:4111';
const MODEL = process.env.EVAL_MODEL; // undefined => agent's DEFAULT_MODEL

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_DIR = join(__dirname, '..', 'eval-results');

type CaseResult = {
  id: string;
  question: string;
  answer: string;
  toolCalls: string[];
  scores: { contains: number; cites: number; toolUsed: number };
};

async function runOne(c: EvalCase): Promise<CaseResult> {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: c.question }],
  };
  if (MODEL) body.requestContext = { model: MODEL };

  const res = await fetch(`${AGENT_BASE}/api/agents/fhirAgent/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Agent ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let answer = '';
  const toolCalls: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const json = line.startsWith('data:') ? line.slice(5).trim() : line;
      if (!json || json === '[DONE]') continue;
      try {
        const evt = JSON.parse(json) as { type?: string; payload?: Record<string, unknown> };
        if (evt.type === 'text-delta' && evt.payload) {
          answer += (evt.payload as { text?: string }).text ?? '';
        } else if (evt.type === 'tool-call' && evt.payload) {
          toolCalls.push((evt.payload as { toolName: string }).toolName);
        }
      } catch { /* ignore */ }
    }
  }

  // strip <think> blocks before scoring (some models emit reasoning)
  answer = answer.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

  const lower = answer.toLowerCase();
  const containsHit = c.contains.filter(s => lower.includes(s.toLowerCase())).length;
  const citesHit = c.cites.filter(s => lower.includes(s.toLowerCase())).length;
  return {
    id: c.id,
    question: c.question,
    answer,
    toolCalls,
    scores: {
      contains: c.contains.length === 0 ? 1 : containsHit / c.contains.length,
      cites: c.cites.length === 0 ? 1 : citesHit / c.cites.length,
      toolUsed: toolCalls.length > 0 ? 1 : 0,
    },
  };
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}
function pct(x: number): string {
  return (x * 100).toFixed(0).padStart(3, ' ') + '%';
}

async function main() {
  console.log(`Running ${CASES.length} eval cases against ${AGENT_BASE}${MODEL ? ` (model=${MODEL})` : ''}\n`);

  const results: CaseResult[] = [];
  for (const c of CASES) {
    process.stdout.write(`  ${pad(c.id, 22)}`);
    try {
      const r = await runOne(c);
      results.push(r);
      console.log(
        `contains=${pct(r.scores.contains)}  cites=${pct(r.scores.cites)}  tools=${r.toolCalls.length > 0 ? r.toolCalls.join(',') : '—'}`,
      );
    } catch (e) {
      console.log(`ERROR: ${String(e)}`);
      results.push({
        id: c.id, question: c.question, answer: `ERROR: ${String(e)}`,
        toolCalls: [], scores: { contains: 0, cites: 0, toolUsed: 0 },
      });
    }
  }

  const avg = (key: keyof CaseResult['scores']) =>
    results.reduce((a, r) => a + r.scores[key], 0) / results.length;

  console.log('\n────────────────────────────────────────────────');
  console.log(`average contains: ${pct(avg('contains'))}`);
  console.log(`average cites:    ${pct(avg('cites'))}`);
  console.log(`tool-call rate:   ${pct(avg('toolUsed'))}`);
  console.log('────────────────────────────────────────────────');

  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(RESULTS_DIR, `${stamp}.json`);
  await writeFile(path, JSON.stringify({ model: MODEL ?? 'default', when: stamp, results }, null, 2));
  console.log(`\nReport: ${path}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
