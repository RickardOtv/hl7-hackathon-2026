/**
 * Thin HTTP wrapper around the Spring Boot FHIR proxy at http://localhost:8181.
 * All Mastra tools call into this. Throws on non-2xx so the agent's tool-call
 * surface gets a clean error.
 */

const PROXY_BASE = process.env.PROXY_BASE ?? 'http://localhost:8181';

async function getJson<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status} ${res.statusText}: ${await res.text().catch(() => '')}`);
  }
  return (await res.json()) as T;
}

async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status} ${res.statusText}: ${await res.text().catch(() => '')}`);
  }
  return (await res.json()) as T;
}

export const proxy = {
  getPatient: () => getJson('/fhir/Patient/current-user'),
  searchAppointments: (status?: string) =>
    getJson(
      `/fhir/Appointment?patient=Patient/current-user${status ? `&status=${encodeURIComponent(status)}` : ''}`,
    ),
  searchMessages: () =>
    getJson('/fhir/Communication?recipient=Patient/current-user'),
  getMessage: (id: string) =>
    getJson(`/fhir/Communication/${encodeURIComponent(id)}`),
  getCapabilityStatement: () => getJson('/fhir/metadata'),
  transformPatient: (body: Record<string, unknown>) =>
    postJson('/transform/Patient', body),
  transformAppointment: (body: unknown) =>
    postJson('/transform/Appointment', body),
  transformCommunication: (body: unknown) =>
    postJson('/transform/Communication', body),
};
