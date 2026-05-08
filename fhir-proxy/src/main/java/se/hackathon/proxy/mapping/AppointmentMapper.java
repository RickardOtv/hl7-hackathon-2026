package se.hackathon.proxy.mapping;

import com.fasterxml.jackson.databind.JsonNode;
import org.hl7.fhir.r4.model.*;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import static se.hackathon.proxy.mapping.FhirConstants.HSA_ID_SYSTEM;
import static se.hackathon.proxy.mapping.FhirConstants.PATIENT_REFERENCE;
import static se.hackathon.proxy.mapping.JsonNodes.isPresent;
import static se.hackathon.proxy.mapping.JsonNodes.text;

/**
 * Maps bokadetider /api/appointments JSON to a list of FHIR R4 Appointment resources.
 *
 * Source shape is inferred (the captured user had no appointments). The mapper is
 * defensive: any missing field is skipped, status defaults to "proposed".
 *
 * Status mapping (1177 -> FHIR R4 AppointmentStatus):
 *   BOOKED    -> booked
 *   CANCELLED -> cancelled
 *   COMPLETED -> fulfilled
 *   *         -> proposed
 */
public final class AppointmentMapper {

    private AppointmentMapper() {}

    /** {@code root} may be a JSON array, an object with "items", or null. */
    public static List<Appointment> buildAll(JsonNode root) {
        List<Appointment> out = new ArrayList<>();
        if (root == null) return out;

        JsonNode array = root;
        if (root.isObject() && root.has("items") && root.get("items").isArray()) {
            array = root.get("items");
        }
        if (!array.isArray()) return out;

        for (JsonNode item : array) {
            out.add(buildOne(item));
        }
        return out;
    }

    public static Appointment buildOne(JsonNode item) {
        Appointment appt = new Appointment();
        if (item.hasNonNull("id")) {
            appt.setId(item.get("id").asText());
        }

        // status (required in R4)
        Appointment.AppointmentStatus status = mapStatus(text(item, "status"));
        appt.setStatus(status);

        // start / end
        if (isPresent(item, "start")) {
            appt.setStart(parseInstant(item.get("start").asText()));
        }
        if (isPresent(item, "end")) {
            appt.setEnd(parseInstant(item.get("end").asText()));
        }

        // service / reason
        String service = text(item, "service");
        if (service != null) {
            appt.addServiceType(new CodeableConcept().setText(service));
        }
        String reason = text(item, "reason");
        if (reason != null) {
            appt.setDescription(reason);
        }

        // facility participant (Location-typed)
        String facilityName = text(item, "facilityName");
        String facilityHsaId = text(item, "facilityHsaId");
        if (facilityName != null || facilityHsaId != null) {
            Reference actor = new Reference();
            if (facilityName != null) actor.setDisplay(facilityName);
            if (facilityHsaId != null) {
                actor.setIdentifier(new Identifier()
                    .setSystem(HSA_ID_SYSTEM)
                    .setValue(facilityHsaId));
            }
            actor.setType("Location");
            appt.addParticipant()
                .setActor(actor)
                .setStatus(Appointment.ParticipationStatus.ACCEPTED)
                .setRequired(Appointment.ParticipantRequired.REQUIRED);
        }

        // patient participant — required so the resource is meaningful
        appt.addParticipant()
            .setActor(new Reference(PATIENT_REFERENCE))
            .setStatus(Appointment.ParticipationStatus.ACCEPTED)
            .setRequired(Appointment.ParticipantRequired.REQUIRED);

        return appt;
    }

    private static Appointment.AppointmentStatus mapStatus(String s) {
        if (s == null) return Appointment.AppointmentStatus.PROPOSED;
        return switch (s.toUpperCase(Locale.ROOT)) {
            case "BOOKED" -> Appointment.AppointmentStatus.BOOKED;
            case "CANCELLED", "CANCELED" -> Appointment.AppointmentStatus.CANCELLED;
            case "COMPLETED" -> Appointment.AppointmentStatus.FULFILLED;
            case "ARRIVED" -> Appointment.AppointmentStatus.ARRIVED;
            case "NOSHOW", "NO_SHOW" -> Appointment.AppointmentStatus.NOSHOW;
            default -> Appointment.AppointmentStatus.PROPOSED;
        };
    }

    private static Date parseInstant(String iso) {
        // FHIR DateTimeType / InstantType accept ISO-8601 strings; rely on HAPI parser.
        return new InstantType(iso).getValue();
    }
}
