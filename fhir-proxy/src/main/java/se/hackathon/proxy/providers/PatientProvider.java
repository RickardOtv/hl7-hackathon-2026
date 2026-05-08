package se.hackathon.proxy.providers;

import ca.uhn.fhir.rest.annotation.IdParam;
import ca.uhn.fhir.rest.annotation.Read;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.InternalErrorException;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Patient;
import se.hackathon.proxy.mapping.FhirConstants;
import se.hackathon.proxy.mapping.PatientMapper;
import se.hackathon.proxy.upstream.UpstreamSource;

import java.io.IOException;

public class PatientProvider implements IResourceProvider {

    private final UpstreamSource upstream;

    public PatientProvider(UpstreamSource upstream) {
        this.upstream = upstream;
    }

    @Override
    public Class<Patient> getResourceType() {
        return Patient.class;
    }

    /**
     * GET /fhir/Patient/{id}
     *
     * Only the magic id {@link FhirConstants#PATIENT_ID} is meaningful —
     * the proxy is single-tenant per session.
     */
    @Read
    public Patient read(@IdParam IdType id) {
        if (id == null || !FhirConstants.PATIENT_ID.equals(id.getIdPart())) {
            throw new ResourceNotFoundException(id);
        }
        return loadCurrent();
    }

    private Patient loadCurrent() {
        try {
            return PatientMapper.build(
                upstream.intygUser(),
                upstream.tidbokUsersCurrent(),
                upstream.etjansterUserprofile(),
                upstream.bokadetiderUser()
            );
        } catch (IOException e) {
            throw new InternalErrorException("Failed to assemble Patient: " + e.getMessage(), e);
        }
    }
}
