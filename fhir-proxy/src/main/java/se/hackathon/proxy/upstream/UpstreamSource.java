package se.hackathon.proxy.upstream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Pluggable source of upstream 1177 JSON.
 *
 * Two implementations:
 *   - FixtureUpstreamSource: loads sanitized JSON from src/main/resources/fixtures/
 *   - LiveUpstreamSource:    forwards a Cookie header to https://*.1177.se
 *
 * Methods return parsed Jackson {@link JsonNode}s (or null if upstream said so).
 * The mappers consume JsonNode and produce typed FHIR resources.
 */
public abstract class UpstreamSource {

    static final ObjectMapper MAPPER = new ObjectMapper();

    public abstract JsonNode etjansterUserprofile() throws IOException;
    public abstract JsonNode etjansterInboxMessages() throws IOException;
    public abstract JsonNode bokadetiderUser() throws IOException;
    public abstract JsonNode bokadetiderAppointments() throws IOException;
    public abstract JsonNode intygUser() throws IOException;
    public abstract JsonNode tidbokUsersCurrent() throws IOException;

    public static UpstreamSource create(String mode) {
        if ("live".equalsIgnoreCase(mode)) {
            String cookie = System.getenv("PROXY_COOKIE");
            if (cookie == null || cookie.isBlank()) {
                throw new IllegalStateException(
                    "PROXY_MODE=live requires PROXY_COOKIE env (raw Cookie header from a logged-in 1177 session)");
            }
            // Reject CR/LF so a malformed env can't smuggle extra headers into the upstream request.
            if (cookie.indexOf('\r') >= 0 || cookie.indexOf('\n') >= 0) {
                throw new IllegalStateException("PROXY_COOKIE must not contain CR or LF characters");
            }
            return new LiveUpstreamSource(cookie);
        }
        return new FixtureUpstreamSource();
    }

    /** Reads a fixture JSON file from the classpath. */
    static JsonNode readFixture(String name) throws IOException {
        String path = "fixtures/" + name;
        try (InputStream is = UpstreamSource.class.getClassLoader().getResourceAsStream(path)) {
            if (is == null) throw new IOException("Fixture not found: " + path);
            return MAPPER.readTree(is);
        }
    }

    /** Reads from upstream over HTTP, attaching the configured Cookie header. */
    static class LiveUpstreamSource extends UpstreamSource {
        private static final Logger log = LoggerFactory.getLogger(LiveUpstreamSource.class);
        private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
        private final String cookie;

        LiveUpstreamSource(String cookie) {
            this.cookie = cookie;
        }

        private JsonNode get(String url) throws IOException {
            try {
                HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .GET()
                    .timeout(Duration.ofSeconds(15))
                    .header("Accept", "application/json")
                    .header("Cookie", cookie)
                    // 1177 uses a generic "is human" check via UA pattern.
                    .header("User-Agent",
                        "Mozilla/5.0 (Macintosh; FHIR-Hackathon-Proxy)")
                    .build();
                HttpResponse<InputStream> resp = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
                int status = resp.statusCode();
                if (status == 412) {
                    // Session-bootstrap quirk: retry once.
                    log.warn("412 Precondition Failed from {} — retrying once", url);
                    resp = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
                    status = resp.statusCode();
                }
                if (status >= 400) {
                    throw new IOException("Upstream " + url + " returned HTTP " + status);
                }
                return MAPPER.readTree(resp.body());
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted calling " + url, ie);
            }
        }

        @Override public JsonNode etjansterUserprofile() throws IOException {
            return get("https://e-tjanster.1177.se/api/core/userprofile");
        }
        @Override public JsonNode etjansterInboxMessages() throws IOException {
            return get("https://e-tjanster.1177.se/api/core/inbox/message");
        }
        @Override public JsonNode bokadetiderUser() throws IOException {
            return get("https://bokadetider.1177.se/api/user");
        }
        @Override public JsonNode bokadetiderAppointments() throws IOException {
            return get("https://bokadetider.1177.se/api/appointments");
        }
        @Override public JsonNode intygUser() throws IOException {
            return get("https://intyg.1177.se/api/user");
        }
        @Override public JsonNode tidbokUsersCurrent() throws IOException {
            return get("https://tidbok.1177.se/api/scheduling/users/current");
        }
    }

    /** Reads from src/main/resources/fixtures/ — used for offline development & demos. */
    static class FixtureUpstreamSource extends UpstreamSource {
        @Override public JsonNode etjansterUserprofile() throws IOException {
            return readFixture("etjanster-userprofile.json");
        }
        @Override public JsonNode etjansterInboxMessages() throws IOException {
            return readFixture("etjanster-inbox.json");
        }
        @Override public JsonNode bokadetiderUser() throws IOException {
            return readFixture("bokadetider-user.json");
        }
        @Override public JsonNode bokadetiderAppointments() throws IOException {
            return readFixture("bokadetider-appointments.json");
        }
        @Override public JsonNode intygUser() throws IOException {
            return readFixture("intyg-user.json");
        }
        @Override public JsonNode tidbokUsersCurrent() throws IOException {
            return readFixture("tidbok-users-current.json");
        }
    }
}
