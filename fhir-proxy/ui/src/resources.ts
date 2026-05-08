export type ResourceKey = 'patient' | 'appointments' | 'messages';

export type RawInput = {
  label: string;
  fixture: string;
  /** Plain-language description of which 1177 endpoint this fixture comes from. */
  description: string;
  /** Field name expected by /transform/Patient when this input is overridden. */
  patientField?: 'etjansterUserprofile' | 'bokadetiderUser' | 'intygUser' | 'tidbokUsersCurrent';
};

export type ResourceConfig = {
  key: ResourceKey;
  label: string;
  /** Tooltip / one-line explanation of this FHIR resource. */
  blurb: string;
  fhirUrl: string;
  /** POST endpoint that transforms user-supplied JSON to FHIR. */
  transformUrl: string;
  inputs: RawInput[];
};

export const RESOURCES: ResourceConfig[] = [
  {
    key: 'patient',
    label: 'Patient',
    blurb: 'FHIR Patient — demographics, identifiers, and contact info for the logged-in user',
    fhirUrl: '/fhir/Patient/current-user',
    transformUrl: '/transform/Patient',
    inputs: [
      {
        label: 'etjanster · userprofile',
        fixture: 'etjanster-userprofile.json',
        patientField: 'etjansterUserprofile',
        description: '1177 e-services consumer profile — display name (first / last)',
      },
      {
        label: 'bokadetider · user',
        fixture: 'bokadetider-user.json',
        patientField: 'bokadetiderUser',
        description: 'Regional booking system user record — full name and active flag',
      },
      {
        label: 'intyg · user',
        fixture: 'intyg-user.json',
        patientField: 'intygUser',
        description: 'Medical-certificates portal user — personnummer and login method',
      },
      {
        label: 'tidbok · users/current',
        fixture: 'tidbok-users-current.json',
        patientField: 'tidbokUsersCurrent',
        description: 'Appointment book current user — postal address and phone',
      },
    ],
  },
  {
    key: 'appointments',
    label: 'Appointments',
    blurb: 'FHIR Appointment — booked visits from regional 1177 booking systems',
    fhirUrl: '/fhir/Appointment?patient=Patient/current-user',
    transformUrl: '/transform/Appointment',
    inputs: [
      {
        label: 'bokadetider · appointments',
        fixture: 'bokadetider-appointments.json',
        description: 'Booked appointments returned by the regional booking system',
      },
    ],
  },
  {
    key: 'messages',
    label: 'Messages',
    blurb: 'FHIR Communication — secure inbox messages from care providers',
    fhirUrl: '/fhir/Communication?recipient=Patient/current-user',
    transformUrl: '/transform/Communication',
    inputs: [
      {
        label: 'etjanster · inbox',
        fixture: 'etjanster-inbox.json',
        description: 'Secure inbox messages from healthcare providers',
      },
    ],
  },
];

export function fixtureUrl(name: string): string {
  return `/fixtures/raw/${name}`;
}
