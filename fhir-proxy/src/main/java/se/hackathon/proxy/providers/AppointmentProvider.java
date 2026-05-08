package se.hackathon.proxy.providers;

import ca.uhn.fhir.rest.annotation.OptionalParam;
import ca.uhn.fhir.rest.annotation.Search;
import ca.uhn.fhir.rest.param.ReferenceParam;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.InternalErrorException;
import org.hl7.fhir.r4.model.Appointment;
import se.hackathon.proxy.mapping.AppointmentMapper;
import se.hackathon.proxy.upstream.UpstreamSource;

import java.io.IOException;
import java.util.List;

public class AppointmentProvider implements IResourceProvider {

    private final UpstreamSource upstream;

    public AppointmentProvider(UpstreamSource upstream) {
        this.upstream = upstream;
    }

    @Override
    public Class<Appointment> getResourceType() {
        return Appointment.class;
    }

    /**
     * GET /fhir/Appointment?patient=Patient/current-user
     *
     * The 1177 user has at most one logged-in identity, so we ignore the
     * {@code patient} parameter beyond logging it for now.
     */
    @Search
    public List<Appointment> search(@OptionalParam(name = "patient") ReferenceParam patient) {
        try {
            return AppointmentMapper.buildAll(upstream.bokadetiderAppointments());
        } catch (IOException e) {
            throw new InternalErrorException("Failed to fetch appointments: " + e.getMessage(), e);
        }
    }
}
