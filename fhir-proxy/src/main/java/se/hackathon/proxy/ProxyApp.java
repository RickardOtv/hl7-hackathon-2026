package se.hackathon.proxy;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;

/**
 * Spring Boot entrypoint for the 1177 FHIR R4 proxy.
 *
 * Run:    mvn spring-boot:run
 * Or:     java -jar target/fhir-proxy-1177.jar
 *
 * Servlets are registered in {@link ServletConfig}: HAPI's {@code FhirProxyServer}
 * at {@code /fhir/*} and {@link RawFixtureServlet} at {@code /fixtures/raw/*}.
 * Static React bundle is served from {@code classpath:/static/} at {@code /}.
 *
 * Environment variables (kept identical to the pre-Spring entrypoint):
 *   PROXY_PORT     (default 8181)
 *   PROXY_MODE     "fixture" (default) or "live"
 *   PROXY_COOKIE   (live mode only) raw Cookie header value to forward upstream
 */
@SpringBootApplication
public class ProxyApp {

    private static final Logger log = LoggerFactory.getLogger(ProxyApp.class);

    public static void main(String[] args) {
        // Map our env vars onto Spring's standard properties so the embedded
        // server picks them up before the context starts.
        System.setProperty("server.port", System.getenv().getOrDefault("PROXY_PORT", "8181"));
        SpringApplication.run(ProxyApp.class, args);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void announce(ApplicationReadyEvent event) {
        Environment env = event.getApplicationContext().getEnvironment();
        String port = env.getProperty("server.port", "8181");
        String mode = System.getenv().getOrDefault("PROXY_MODE", "fixture");
        log.info("=========================================================");
        log.info("1177 FHIR R4 proxy listening on http://localhost:{}/fhir", port);
        log.info("GUI:  http://localhost:{}/", port);
        log.info("Mode: {}", mode);
        log.info("Try:  curl -s http://localhost:{}/fhir/metadata | jq", port);
        log.info("      curl -s http://localhost:{}/fhir/Patient/current-user | jq", port);
        log.info("      curl -s 'http://localhost:{}/fhir/Communication?recipient=Patient/current-user' | jq", port);
        log.info("=========================================================");
    }
}
