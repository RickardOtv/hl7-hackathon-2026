import { RESOURCES, ResourceKey } from './resources';

type Props = {
  active: ResourceKey;
  onChange: (key: ResourceKey) => void;
};

/** Tiny FHIR-ish glyph per resource type — Patient (person), Appointment (calendar), Communication (envelope). */
function ResourceIcon({ k }: { k: ResourceKey }) {
  switch (k) {
    case 'patient':
      return (
        <svg className="pill-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="5" r="2.5" />
          <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
        </svg>
      );
    case 'appointments':
      return (
        <svg className="pill-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
          <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
        </svg>
      );
    case 'messages':
      return (
        <svg className="pill-icon" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="4" width="12" height="9" rx="1" />
          <path d="M2.5 5l5.5 4 5.5-4" />
        </svg>
      );
  }
}

export function ResourcePills({ active, onChange }: Props) {
  return (
    <div className="resource-group">
      <span className="resource-group-label" id="resource-group-label">
        FHIR resource
      </span>
      <div className="pills" role="tablist" aria-labelledby="resource-group-label">
        {RESOURCES.map(r => (
          <button
            key={r.key}
            role="tab"
            aria-selected={active === r.key}
            title={r.blurb}
            className={'pill' + (active === r.key ? ' pill-active' : '')}
            onClick={() => onChange(r.key)}
          >
            <ResourceIcon k={r.key} />
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
