import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { proxy } from '../../lib/proxyClient.ts';

export const getPatient = createTool({
  id: 'getPatient',
  description:
    "Fetch the current user's FHIR R4 Patient resource — demographics, identifiers (incl. personnummer urn:oid:1.2.752.129.2.1.3.1), name, address, contact info. No arguments.",
  inputSchema: z.object({}),
  execute: async () => proxy.getPatient(),
});

export const searchAppointments = createTool({
  id: 'searchAppointments',
  description:
    "Fetch the current user's upcoming FHIR R4 Appointment resources as a Bundle. Optionally filter by status (booked, cancelled, etc.).",
  inputSchema: z.object({
    status: z
      .enum(['booked', 'cancelled', 'noshow', 'arrived', 'fulfilled', 'pending'])
      .optional()
      .describe('FHIR Appointment.status filter'),
  }),
  execute: async ({ status }) => proxy.searchAppointments(status),
});

export const searchMessages = createTool({
  id: 'searchMessages',
  description:
    "Fetch the current user's inbox as a Bundle of FHIR R4 Communication resources. Each entry has status (in-progress = unread, completed = read), category, subject, sender, sent timestamp.",
  inputSchema: z.object({}),
  execute: async () => proxy.searchMessages(),
});

export const getMessage = createTool({
  id: 'getMessage',
  description:
    'Fetch a single inbox message by id as a FHIR R4 Communication resource. Use after searchMessages to read full details of a specific message.',
  inputSchema: z.object({
    id: z.string().describe('Communication.id from a prior searchMessages call'),
  }),
  execute: async ({ id }) => proxy.getMessage(id),
});

export const getCapabilityStatement = createTool({
  id: 'getCapabilityStatement',
  description:
    'Fetch the FHIR CapabilityStatement so you (or future agents) can discover what resources and operations are supported. Useful when the user asks "what can this server do?"',
  inputSchema: z.object({}),
  execute: async () => proxy.getCapabilityStatement(),
});

export const transformPatient = createTool({
  id: 'transformPatient',
  description:
    'Run the 1177→FHIR mapper on user-supplied raw 1177 JSON to build a Patient. Any subset of {etjansterUserprofile, bokadetiderUser, intygUser, tidbokUsersCurrent} is accepted; missing keys fall back to bundled fixtures.',
  inputSchema: z.object({
    etjansterUserprofile: z.record(z.any()).optional(),
    bokadetiderUser: z.record(z.any()).optional(),
    intygUser: z.record(z.any()).optional(),
    tidbokUsersCurrent: z.record(z.any()).optional(),
  }),
  execute: async (input) => proxy.transformPatient(input),
});

export const transformAppointment = createTool({
  id: 'transformAppointment',
  description:
    'Run the 1177→FHIR mapper on user-supplied raw bokadetider appointments JSON to produce a FHIR Appointment Bundle.',
  inputSchema: z.object({
    raw: z.record(z.any()).describe('Raw bokadetider-appointments JSON object'),
  }),
  execute: async ({ raw }) => proxy.transformAppointment(raw),
});

export const transformCommunication = createTool({
  id: 'transformCommunication',
  description:
    'Run the 1177→FHIR mapper on user-supplied raw etjanster inbox JSON to produce a FHIR Communication Bundle.',
  inputSchema: z.object({
    raw: z.record(z.any()).describe('Raw etjanster-inbox JSON object'),
  }),
  execute: async ({ raw }) => proxy.transformCommunication(raw),
});
