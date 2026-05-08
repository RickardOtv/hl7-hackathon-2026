package se.hackathon.proxy;

import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Registers the two raw servlets that Spring's MVC layer doesn't own:
 *
 *   - HAPI's {@link FhirProxyServer} at {@code /fhir/*} — REST FHIR R4 facade.
 *   - {@link RawFixtureServlet} at {@code /fixtures/raw/*} — sanitized 1177 JSON fixtures.
 *
 * Static React bundle at {@code classpath:/static/} is served automatically by
 * Spring Boot's default resource handlers (no config needed).
 */
@Configuration
public class ServletConfig {

    @Bean
    public ServletRegistrationBean<FhirProxyServer> fhirServlet() {
        String mode = System.getenv().getOrDefault("PROXY_MODE", "fixture");
        ServletRegistrationBean<FhirProxyServer> reg =
            new ServletRegistrationBean<>(new FhirProxyServer(mode), "/fhir/*");
        reg.setName("fhirServlet");
        reg.setLoadOnStartup(1);
        return reg;
    }

    @Bean
    public ServletRegistrationBean<RawFixtureServlet> rawFixtureServlet() {
        ServletRegistrationBean<RawFixtureServlet> reg =
            new ServletRegistrationBean<>(new RawFixtureServlet(), "/fixtures/raw/*");
        reg.setName("rawFixtureServlet");
        return reg;
    }
}
