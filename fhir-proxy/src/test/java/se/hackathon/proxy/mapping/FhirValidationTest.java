package se.hackathon.proxy.mapping;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.validation.FhirValidator;
import ca.uhn.fhir.validation.SingleValidationMessage;
import ca.uhn.fhir.validation.ValidationResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import ca.uhn.fhir.context.support.DefaultProfileValidationSupport;
import org.hl7.fhir.common.hapi.validation.support.CommonCodeSystemsTerminologyService;
import org.hl7.fhir.common.hapi.validation.support.InMemoryTerminologyServerValidationSupport;
import org.hl7.fhir.common.hapi.validation.support.ValidationSupportChain;
import org.hl7.fhir.common.hapi.validation.validator.FhirInstanceValidator;
import org.hl7.fhir.r4.model.Appointment;
import org.hl7.fhir.r4.model.Communication;
import org.hl7.fhir.r4.model.Patient;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.List;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * End-to-end mapper validation. Runs each mapper on the bundled fixtures and
 * asserts that HAPI FHIR's official R4 validator emits no errors.
 *
 * Validation severity policy:
 *   - ERROR     -> fail the test
 *   - WARNING   -> log only (extensions on unknown URLs trigger these — expected)
 *   - INFO      -> log only
 */
class FhirValidationTest {

    static FhirContext ctx;
    static FhirValidator validator;
    static ObjectMapper json = new ObjectMapper();

    @BeforeAll
    static void setUp() {
        ctx = FhirContext.forR4();
        validator = ctx.newValidator();

        // Standard HAPI 7.x validation chain.
        // - DefaultProfileValidationSupport: base R4 StructureDefinitions
        // - CommonCodeSystemsTerminologyService: CSes outside the spec (UCUM, ISO 3166, BCP-47, etc.)
        // - InMemoryTerminologyServerValidationSupport: expands ValueSets defined in the loaded CodeSystems,
        //   which is what makes "booked", "phone", "official", "home", "completed", … recognised.
        ValidationSupportChain chain = new ValidationSupportChain(
            new DefaultProfileValidationSupport(ctx),
            new CommonCodeSystemsTerminologyService(ctx),
            new InMemoryTerminologyServerValidationSupport(ctx)
        );
        FhirInstanceValidator instanceValidator = new FhirInstanceValidator(chain);
        validator.registerValidatorModule(instanceValidator);
    }

    @Test
    void patient_validates() throws Exception {
        Patient patient = PatientMapper.build(
            readFixture("intyg-user.json"),
            readFixture("tidbok-users-current.json"),
            readFixture("etjanster-userprofile.json"),
            readFixture("bokadetider-user.json")
        );
        printAndAssertValid("Patient", patient);
    }

    @Test
    void appointments_validate() throws Exception {
        List<Appointment> appts = AppointmentMapper.buildAll(readFixture("bokadetider-appointments.json"));
        assertFalse(appts.isEmpty(), "expected at least one demo appointment");
        for (Appointment appt : appts) {
            printAndAssertValid("Appointment[" + appt.getIdElement().getIdPart() + "]", appt);
        }
    }

    @Test
    void communications_validate() throws Exception {
        List<Communication> comms = CommunicationMapper.buildAll(readFixture("etjanster-inbox.json"));
        assertFalse(comms.isEmpty(), "expected at least one inbox message");
        for (Communication c : comms) {
            printAndAssertValid("Communication[" + c.getIdElement().getIdPart() + "]", c);
        }
    }

    // -- helpers -----------------------------------------------------------

    private static JsonNode readFixture(String name) throws Exception {
        try (InputStream is = FhirValidationTest.class.getClassLoader()
                .getResourceAsStream("fixtures/" + name)) {
            if (is == null) throw new IllegalStateException("missing fixture: " + name);
            return json.readTree(is);
        }
    }

    private static void printAndAssertValid(String label, org.hl7.fhir.instance.model.api.IBaseResource resource) {
        String serialized = ctx.newJsonParser().setPrettyPrint(true).encodeResourceToString(resource);
        System.out.println("---- " + label + " ----");
        System.out.println(serialized);

        ValidationResult result = validator.validateWithResult(resource);
        List<SingleValidationMessage> errors = result.getMessages().stream()
            .filter(m -> m.getSeverity() == ca.uhn.fhir.validation.ResultSeverityEnum.ERROR
                      || m.getSeverity() == ca.uhn.fhir.validation.ResultSeverityEnum.FATAL)
            .collect(Collectors.toList());
        for (SingleValidationMessage msg : result.getMessages()) {
            System.out.println("  [" + msg.getSeverity() + "] " + msg.getLocationString() + " " + msg.getMessage());
        }
        assertTrue(errors.isEmpty(),
            label + " produced " + errors.size() + " error(s): "
                + errors.stream().map(SingleValidationMessage::getMessage).collect(Collectors.joining(" | ")));
    }
}
