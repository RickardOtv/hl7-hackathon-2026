import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import * as tools from '../tools/index.ts';

const OLLAMA_BASE = process.env.OLLAMA_BASE ?? 'http://localhost:11434/v1';
// Models known to support tools through Ollama's OpenAI-compat layer:
//   qwen3, qwen2.5, llama3.2, llama3.1, mistral, command-r.
// Models that DON'T: gemma3, deepseek-r1, phi.
const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? 'qwen3:4b';

const ollama = createOpenAI({
  baseURL: OLLAMA_BASE,
  apiKey: 'ollama',
});

export const fhirAgent = new Agent({
  id: 'fhirAgent',
  name: 'FHIR Patient Access',
  instructions: `You are a Swedish patient-access assistant. The user is looking
at a FHIR R4 resource on screen and wants to ask questions about their
healthcare data — appointments, messages, demographics.

Behaviour:
- The currently-displayed FHIR resource is provided as context in the user
  message. Use it directly when the question is about *that* resource.
- For follow-up details about *other* resources (e.g. "any new messages?"
  while looking at Patient), call the appropriate tool: getPatient,
  searchAppointments, searchMessages, getMessage, getCapabilityStatement.
- Never speculate. If the answer isn't in the FHIR data, say so.
- When you cite a value, name the FHIR path it came from in parentheses,
  e.g. "Göteborg (Patient.address[0].city)".
- Identifier systems to recognise:
  · urn:oid:1.2.752.129.2.1.3.1 — Swedish personnummer
  · urn:oid:1.2.752.29.4.71 — Swedish HSA-ID (healthcare professional/org)
- Reply in the user's language (Swedish if they write Swedish, else English).
- Be concise. Bullet only when the answer is genuinely a list.`,
  model: ({ requestContext }) => {
    // requestContext is a Map-like RequestContext, populated from the request body's
    // `requestContext` field. Pull the model name out, fall back to the default.
    const picked = (requestContext as { get?: (k: string) => unknown })?.get?.('model');
    const modelName = (typeof picked === 'string' ? picked : DEFAULT_MODEL);
    // .chat() routes to /v1/chat/completions; .responses() goes to /v1/responses (OpenAI only).
    return ollama.chat(modelName);
  },
  tools: {
    getPatient: tools.getPatient,
    searchAppointments: tools.searchAppointments,
    searchMessages: tools.searchMessages,
    getMessage: tools.getMessage,
    getCapabilityStatement: tools.getCapabilityStatement,
    transformPatient: tools.transformPatient,
    transformAppointment: tools.transformAppointment,
    transformCommunication: tools.transformCommunication,
  },
});
