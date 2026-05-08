package se.hackathon.proxy.providers;

import ca.uhn.fhir.rest.annotation.IdParam;
import ca.uhn.fhir.rest.annotation.OptionalParam;
import ca.uhn.fhir.rest.annotation.Read;
import ca.uhn.fhir.rest.annotation.Search;
import ca.uhn.fhir.rest.param.ReferenceParam;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.InternalErrorException;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import org.hl7.fhir.r4.model.Communication;
import org.hl7.fhir.r4.model.IdType;
import se.hackathon.proxy.mapping.CommunicationMapper;
import se.hackathon.proxy.upstream.UpstreamSource;

import java.io.IOException;
import java.util.List;

public class CommunicationProvider implements IResourceProvider {

    private final UpstreamSource upstream;

    public CommunicationProvider(UpstreamSource upstream) {
        this.upstream = upstream;
    }

    @Override
    public Class<Communication> getResourceType() {
        return Communication.class;
    }

    /**
     * GET /fhir/Communication?recipient=Patient/current-user
     */
    @Search
    public List<Communication> search(@OptionalParam(name = "recipient") ReferenceParam recipient) {
        try {
            return CommunicationMapper.buildAll(upstream.etjansterInboxMessages());
        } catch (IOException e) {
            throw new InternalErrorException("Failed to fetch inbox: " + e.getMessage(), e);
        }
    }

    /**
     * GET /fhir/Communication/{id}
     *
     * The 1177 inbox list response doesn't carry message body. For the hackathon
     * we look up the message by id from the cached list. A production version
     * should call the per-message endpoint to fetch full body.
     */
    @Read
    public Communication read(@IdParam IdType id) {
        try {
            return CommunicationMapper.buildAll(upstream.etjansterInboxMessages()).stream()
                .filter(c -> id.getIdPart().equals(c.getIdElement().getIdPart()))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException(id));
        } catch (IOException e) {
            throw new InternalErrorException("Failed to fetch inbox: " + e.getMessage(), e);
        }
    }
}
