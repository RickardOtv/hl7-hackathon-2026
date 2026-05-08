package se.hackathon.proxy;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.server.RestfulServer;
import ca.uhn.fhir.rest.server.interceptor.ResponseHighlighterInterceptor;
import jakarta.servlet.ServletException;
import se.hackathon.proxy.providers.AppointmentProvider;
import se.hackathon.proxy.providers.CommunicationProvider;
import se.hackathon.proxy.providers.PatientProvider;
import se.hackathon.proxy.upstream.UpstreamSource;

import java.util.List;

/**
 * HAPI FHIR Plain Server (RestfulServer) — wires together the IResourceProvider
 * classes that translate 1177 JSON to FHIR R4 resources.
 *
 * Mounted at "/fhir/*" by {@link ProxyApp}.
 */
public class FhirProxyServer extends RestfulServer {

    private final String mode;

    public FhirProxyServer(String mode) {
        super(FhirContext.forR4());
        this.mode = mode;
    }

    @Override
    protected void initialize() throws ServletException {
        UpstreamSource upstream = UpstreamSource.create(mode);

        setResourceProviders(List.of(
            new PatientProvider(upstream),
            new AppointmentProvider(upstream),
            new CommunicationProvider(upstream)
        ));

        // Pretty-print + browser-friendly when ?_format=html or Accept: text/html.
        registerInterceptor(new ResponseHighlighterInterceptor());

        // Default to JSON, pretty-printed
        setDefaultPrettyPrint(true);
        setDefaultResponseEncoding(ca.uhn.fhir.rest.api.EncodingEnum.JSON);

        // Help upstream/cors-debugging during demo: allow common dev origins.
        // (Skipped CORS interceptor to keep deps minimal — add hapi-fhir-server-cors if needed.)
    }
}
