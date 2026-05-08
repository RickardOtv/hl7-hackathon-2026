package se.hackathon.proxy;

import ca.uhn.fhir.context.FhirContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.hl7.fhir.r4.model.Appointment;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Communication;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import se.hackathon.proxy.mapping.AppointmentMapper;
import se.hackathon.proxy.mapping.CommunicationMapper;
import se.hackathon.proxy.mapping.PatientMapper;
import se.hackathon.proxy.upstream.UpstreamSource;

import java.io.IOException;
import java.util.List;

/**
 * On-the-fly transform endpoints used by the GUI's drop zone — accept raw 1177
 * upstream JSON, run the existing mappers, and return the same FHIR shape the
 * /fhir/* endpoints emit (Bundle for collection resources, Patient for the
 * single-tenant patient).
 *
 * Distinct from the HAPI servlet so we can keep /fhir/* purely conformant.
 */
@RestController
@RequestMapping(path = "/transform", produces = "application/fhir+json")
public class TransformController {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final FhirContext FHIR = FhirContext.forR4();

    /** Body: raw bokadetider-appointments JSON. */
    @PostMapping(path = "/Appointment", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> appointment(@RequestBody String body) throws IOException {
        JsonNode root = JSON.readTree(body);
        List<Appointment> apps = AppointmentMapper.buildAll(root);
        return ok(toBundle(apps));
    }

    /** Body: raw etjanster-inbox JSON. */
    @PostMapping(path = "/Communication", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> communication(@RequestBody String body) throws IOException {
        JsonNode root = JSON.readTree(body);
        List<Communication> msgs = CommunicationMapper.buildAll(root);
        return ok(toBundle(msgs));
    }

    /**
     * Body: any subset of {etjansterUserprofile, bokadetiderUser, intygUser,
     * tidbokUsersCurrent}. Missing keys fall back to the bundled fixture, so the
     * UI can drop one tab at a time.
     */
    @PostMapping(path = "/Patient", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> patient(@RequestBody String body) throws IOException {
        JsonNode req = JSON.readTree(body);
        UpstreamSource fallback = UpstreamSource.create("fixture");

        JsonNode etjanster = orFallback(req, "etjansterUserprofile", fallback::etjansterUserprofile);
        JsonNode bokadetider = orFallback(req, "bokadetiderUser", fallback::bokadetiderUser);
        JsonNode intyg = orFallback(req, "intygUser", fallback::intygUser);
        JsonNode tidbok = orFallback(req, "tidbokUsersCurrent", fallback::tidbokUsersCurrent);

        Patient p = PatientMapper.build(intyg, tidbok, etjanster, bokadetider);
        return ok(FHIR.newJsonParser().setPrettyPrint(true).encodeResourceToString(p));
    }

    private static JsonNode orFallback(JsonNode body, String key, IoSupplier fallback) throws IOException {
        if (body.hasNonNull(key)) {
            return body.get(key);
        }
        return fallback.get();
    }

    private static Bundle toBundle(List<? extends Resource> resources) {
        Bundle b = new Bundle();
        b.setType(Bundle.BundleType.SEARCHSET);
        b.setTotal(resources.size());
        for (Resource r : resources) {
            b.addEntry().setResource(r);
        }
        return b;
    }

    private static ResponseEntity<String> ok(Bundle b) {
        return ok(FHIR.newJsonParser().setPrettyPrint(true).encodeResourceToString(b));
    }

    private static ResponseEntity<String> ok(String body) {
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/fhir+json")).body(body);
    }

    @FunctionalInterface
    private interface IoSupplier { JsonNode get() throws IOException; }
}
