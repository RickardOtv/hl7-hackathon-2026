import { Mastra } from '@mastra/core';
import { fhirAgent } from './agents/fhirAgent.ts';

export const mastra = new Mastra({
  agents: { fhirAgent },
});
