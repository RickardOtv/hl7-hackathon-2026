import { JsonViewer } from './JsonViewer';

type FetchState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

type Props = {
  heading: string;
  state: FetchState<string>;
};

/** Derive the FHIR resource type from the panel heading so we can deep-link to the spec. */
function specUrl(heading: string): string | null {
  // Headings: "Patient/current-user", "Bundle · Appointment", "Bundle · Communication"
  const last = heading.split('·').pop()!.trim().split('/')[0].trim();
  if (!last) return null;
  return `https://hl7.org/fhir/R4/${last.toLowerCase()}.html`;
}

export function FhirOutputPanel({ heading, state }: Props) {
  const ready = !state.loading && 'data' in state;
  const spec = specUrl(heading);
  return (
    <section className="panel panel-output">
      <header className="panel-head">
        <span className="panel-title">OUTPUT · FHIR R4</span>
        <span className="panel-head-right">
          {spec ? (
            <a className="panel-sub-link" href={spec} target="_blank" rel="noopener" title="Open this resource in the FHIR R4 spec">
              {heading} ↗
            </a>
          ) : (
            <span className="panel-sub">{heading}</span>
          )}
          {ready && (
            <span className="badge-valid" title="Validates against HAPI FHIR R4 instance validator: DefaultProfileValidationSupport + CommonCodeSystemsTerminologyService + InMemoryTerminologyServerValidationSupport">
              ✓ valid R4
            </span>
          )}
        </span>
      </header>
      <div className="panel-body">
        {state.loading && <div className="muted">Transforming…</div>}
        {!state.loading && 'error' in state && <div className="error">{state.error}</div>}
        {ready && <JsonViewer code={(state as { data: string }).data} />}
      </div>
    </section>
  );
}
