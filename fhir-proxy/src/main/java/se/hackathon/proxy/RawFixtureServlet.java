package se.hackathon.proxy;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.io.InputStream;
import java.util.Set;

/**
 * Serves the sanitized 1177 fixture JSONs verbatim so the GUI's left
 * "input" panel can show the raw upstream alongside the FHIR output.
 *
 * Mounted at /fixtures/raw/* by {@link ProxyApp}. Whitelist is hard-coded —
 * we never want this servlet to read anything else from the classpath.
 */
public class RawFixtureServlet extends HttpServlet {

    private static final Set<String> ALLOWED = Set.of(
        "etjanster-userprofile.json",
        "etjanster-inbox.json",
        "bokadetider-user.json",
        "bokadetider-appointments.json",
        "intyg-user.json",
        "tidbok-users-current.json"
    );

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String path = req.getPathInfo();
        if (path == null || path.length() < 2) {
            resp.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        String name = path.substring(1);
        if (!ALLOWED.contains(name)) {
            resp.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        try (InputStream is = getClass().getClassLoader().getResourceAsStream("fixtures/" + name)) {
            if (is == null) {
                resp.sendError(HttpServletResponse.SC_NOT_FOUND);
                return;
            }
            resp.setContentType("application/json");
            resp.setCharacterEncoding("UTF-8");
            resp.setHeader("Cache-Control", "no-cache");
            is.transferTo(resp.getOutputStream());
        }
    }
}
