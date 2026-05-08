import { ResourceKey } from './resources';
import { RawInputPanel } from './RawInputPanel';
import { FhirOutputPanel } from './FhirOutputPanel';

type FetchState<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string };

type Props = {
  resourceKey: ResourceKey;
  inputLabels: string[];
  inputDescriptions: string[];
  inputs: FetchState<string[]>;
  fhir: FetchState<string>;
  fhirHeading: string;
  modified: boolean[];
  onDrop: (tabIndex: number, file: File) => void;
  onRevert: (tabIndex?: number) => void;
};

export function SplitView({
  resourceKey, inputLabels, inputDescriptions, inputs, fhir, fhirHeading, modified, onDrop, onRevert,
}: Props) {
  // Replay the chevron animation whenever the FHIR output changes — i.e. on
  // resource swap, override apply, or revert. Re-keying remounts the element.
  const flowKey = resourceKey + ':' + (
    fhir.loading ? 'L' : 'data' in fhir ? fhir.data.length : 'E'
  );
  return (
    <div className="split" key={resourceKey}>
      <RawInputPanel
        labels={inputLabels}
        descriptions={inputDescriptions}
        state={inputs}
        modified={modified}
        onDrop={onDrop}
        onRevert={onRevert}
      />
      <div className="flow" aria-hidden="true" key={flowKey}>
        <span className="chev">›</span>
        <span className="chev">›</span>
        <span className="chev">›</span>
      </div>
      <FhirOutputPanel heading={fhirHeading} state={fhir} />
    </div>
  );
}
