package se.hackathon.proxy.mapping;

/**
 * Single source of truth for the OID systems, hackathon-namespaced extension
 * URLs, and the magic single-tenant patient id used by the mappers and the
 * Patient provider.
 *
 * Hackathon-namespaced extension URLs (`https://hackathon.example/se/...`) are
 * intentional placeholders, not a real domain. Production usage would register
 * StructureDefinitions and switch to those URLs.
 */
public final class FhirConstants {

    private FhirConstants() {}

    /** Swedish personnummer OID — registered FHIR identifier system. */
    public static final String PERSONNUMMER_SYSTEM = "urn:oid:1.2.752.129.2.1.3.1";

    /** Swedish HSA-ID OID — used for healthcare professional / facility / org identifiers. */
    public static final String HSA_ID_SYSTEM = "urn:oid:1.2.752.29.4.71";

    /** System identifier for surfacing the original 1177 inbox URL on Communication.identifier. */
    public static final String INBOX_URL_SYSTEM = "https://1177.se/inbox-url";

    // -- Hackathon-namespaced extension URLs ------------------------------------------------------

    public static final String COUNTY_EXT_URL          = "https://hackathon.example/se/county-code";
    public static final String MUNICIPALITY_EXT_URL    = "https://hackathon.example/se/municipality-code";
    public static final String LOGIN_METHOD_EXT_URL    = "https://hackathon.example/se/login-method";
    public static final String FAVORITE_EXT_URL        = "https://hackathon.example/se/communication/favorite";
    public static final String THREAD_COUNT_EXT_URL    = "https://hackathon.example/se/communication/messages-in-thread";
    public static final String HAS_ATTACHMENT_EXT_URL  = "https://hackathon.example/se/communication/has-attachment";

    // -- Single-tenant patient identity -----------------------------------------------------------

    /** The proxy is single-tenant per session; one logged-in 1177 user maps to one FHIR Patient. */
    public static final String PATIENT_ID = "current-user";

    /** Pre-built reference string for use in `Reference("Patient/current-user")`. */
    public static final String PATIENT_REFERENCE = "Patient/" + PATIENT_ID;
}
