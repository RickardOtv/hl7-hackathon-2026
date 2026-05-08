/**
 * Hand-written evaluation cases for the FHIR Patient Access agent.
 * Each case asks a question; we score whether the answer mentions every
 * required substring and whether it cites the expected FHIR path(s).
 *
 * Cases are grounded in the bundled fixtures (etjanster-userprofile.json etc.)
 * so they're stable across runs.
 */
export type EvalCase = {
  id: string;
  question: string;
  /** Substrings that MUST appear in the answer (case-insensitive). */
  contains: string[];
  /** FHIR-paths that the answer should cite. Loose match — substring search. */
  cites: string[];
};

export const CASES: EvalCase[] = [
  {
    id: 'patient-name',
    question: "What is the patient's full name?",
    contains: ['Test', 'Testsson'],
    cites: ['Patient.name'],
  },
  {
    id: 'patient-personnummer',
    question: 'What is the patient personnummer and what identifier system is it under?',
    contains: ['199001019999', 'urn:oid:1.2.752.129.2.1.3.1'],
    cites: ['Patient.identifier'],
  },
  {
    id: 'patient-city',
    question: 'In which city does the patient live?',
    contains: ['Göteborg'],
    cites: ['Patient.address'],
  },
  {
    id: 'patient-phone',
    question: "Does the patient have a mobile phone number on file? If yes, what is it?",
    contains: ['+46700000000'],
    cites: ['Patient.telecom'],
  },
  {
    id: 'next-appointment',
    question: 'When is the next appointment, and at which facility?',
    contains: ['2026', 'Vårdcentral'],
    cites: ['Appointment.start', 'Appointment.participant'],
  },
  {
    id: 'appt-count',
    question: 'How many upcoming appointments are scheduled in total?',
    contains: ['2'],
    cites: ['Bundle', 'Appointment'],
  },
  {
    id: 'appt-service-type',
    question: 'What kind of appointment is the first one (service type)?',
    contains: ['Allmänläkare'],
    cites: ['Appointment.serviceType'],
  },
  {
    id: 'inbox-count',
    question: 'How many messages are in the inbox?',
    contains: ['3'],
    cites: ['Communication'],
  },
  {
    id: 'unread-messages',
    question:
      'Are any messages still unread? Communication.status = in-progress means unread, completed means read.',
    contains: ['unread'],
    cites: ['Communication.status'],
  },
  {
    id: 'capability',
    question: 'Which FHIR resources does this server support? Use the CapabilityStatement.',
    contains: ['Patient', 'Appointment', 'Communication'],
    cites: ['CapabilityStatement'],
  },
];
