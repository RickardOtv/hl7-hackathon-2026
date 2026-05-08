import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { ResourcePills } from './ResourcePills';
import { SplitView } from './SplitView';
import { ChatDrawer } from './ChatDrawer';
import { RESOURCES, ResourceKey, fixtureUrl } from './resources';

type FetchState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

/** Per-resource map of fixtureFilename → user-supplied JSON text (drop-zone overrides). */
type OverrideMap = Record<string, string>;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function postJson(url: string, body: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function prettyJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); }
  catch { return text; }
}

export function App() {
  const [active, setActive] = useState<ResourceKey>('patient');
  const config = RESOURCES.find(r => r.key === active)!;

  // overrides[resourceKey][fixtureName] = user-dropped JSON text
  const [overrides, setOverrides] = useState<Record<ResourceKey, OverrideMap>>({
    patient: {}, appointments: {}, messages: {},
  });
  const activeOverrides = overrides[active];

  const [fhir, setFhir] = useState<FetchState<string>>({ loading: true });
  const [inputs, setInputs] = useState<FetchState<string[]>>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setFhir({ loading: true });
    setInputs({ loading: true });

    // Load inputs: prefer override over fixture for each input slot.
    (async () => {
      try {
        const all = await Promise.all(config.inputs.map(async i => {
          const ov = activeOverrides[i.fixture];
          return ov ?? await fetchText(fixtureUrl(i.fixture));
        }));
        if (!cancelled) setInputs({ loading: false, data: all.map(prettyJson) });
      } catch (e) {
        if (!cancelled) setInputs({ loading: false, error: String(e) });
      }
    })();

    // Compute FHIR: GET if no overrides, POST /transform if any override.
    (async () => {
      try {
        const hasOverride = Object.keys(activeOverrides).length > 0;
        let json: string;
        if (!hasOverride) {
          json = await fetchText(config.fhirUrl);
        } else if (active === 'patient') {
          // Patient takes a {field: jsonNode} body with 4 optional keys.
          const body: Record<string, unknown> = {};
          for (const i of config.inputs) {
            const ov = activeOverrides[i.fixture];
            if (ov && i.patientField) body[i.patientField] = JSON.parse(ov);
          }
          json = await postJson(config.transformUrl, JSON.stringify(body));
        } else {
          // Single-input resources: body is the raw JSON itself.
          const i = config.inputs[0];
          const ov = activeOverrides[i.fixture];
          json = await postJson(config.transformUrl, ov!);
        }
        if (!cancelled) setFhir({ loading: false, data: prettyJson(json) });
      } catch (e) {
        if (!cancelled) setFhir({ loading: false, error: String(e) });
      }
    })();

    return () => { cancelled = true; };
  }, [active, activeOverrides]);

  const handleDrop = async (tabIndex: number, file: File) => {
    const text = await file.text();
    try { JSON.parse(text); }
    catch (e) { alert(`Not valid JSON: ${e}`); return; }
    const fixture = config.inputs[tabIndex].fixture;
    setOverrides(prev => ({
      ...prev,
      [active]: { ...prev[active], [fixture]: text },
    }));
  };

  const handleRevert = (tabIndex?: number) => {
    setOverrides(prev => {
      if (tabIndex === undefined) return { ...prev, [active]: {} };
      const fixture = config.inputs[tabIndex].fixture;
      const next = { ...prev[active] };
      delete next[fixture];
      return { ...prev, [active]: next };
    });
  };

  const fhirText = !fhir.loading && 'data' in fhir ? fhir.data : '';
  const modifiedFlags = config.inputs.map(i => Boolean(activeOverrides[i.fixture]));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Icon icon="mdi:campfire" className="brand-mark" />
          <span className="brand-name">BRASA</span>
          <span className="brand-sub">· Patient Access</span>
          <span className="brand-tag" title="Brasa demo running on synthetic 1177 data — no real patient PII">Demo · synthetic data</span>
        </div>
        <ResourcePills active={active} onChange={setActive} />
      </header>

      <main className="workspace">
        <SplitView
          resourceKey={active}
          inputLabels={config.inputs.map(i => i.label)}
          inputDescriptions={config.inputs.map(i => i.description)}
          inputs={inputs}
          fhir={fhir}
          fhirHeading={fhirHeading(active)}
          modified={modifiedFlags}
          onDrop={handleDrop}
          onRevert={handleRevert}
        />
      </main>

      <ChatDrawer resourceLabel={config.label} fhirJson={fhirText} />
    </div>
  );
}

function fhirHeading(key: ResourceKey): string {
  switch (key) {
    case 'patient': return 'Patient/current-user';
    case 'appointments': return 'Bundle · Appointment';
    case 'messages': return 'Bundle · Communication';
  }
}
