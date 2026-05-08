package se.hackathon.proxy.mapping;

import com.fasterxml.jackson.databind.JsonNode;
import org.hl7.fhir.r4.model.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import static se.hackathon.proxy.mapping.FhirConstants.FAVORITE_EXT_URL;
import static se.hackathon.proxy.mapping.FhirConstants.HAS_ATTACHMENT_EXT_URL;
import static se.hackathon.proxy.mapping.FhirConstants.HSA_ID_SYSTEM;
import static se.hackathon.proxy.mapping.FhirConstants.INBOX_URL_SYSTEM;
import static se.hackathon.proxy.mapping.FhirConstants.PATIENT_REFERENCE;
import static se.hackathon.proxy.mapping.FhirConstants.THREAD_COUNT_EXT_URL;
import static se.hackathon.proxy.mapping.JsonNodes.isPresent;
import static se.hackathon.proxy.mapping.JsonNodes.text;

/**
 * Maps e-tjanster /api/core/inbox/message JSON to a list of FHIR R4 Communication resources.
 *
 * Status mapping (1177 readStatus -> FHIR R4 CommunicationStatus):
 *   READ      -> completed
 *   UNREAD    -> in-progress
 *   SENT      -> completed
 *   NOT_SENT  -> preparation
 *   (unknown) -> unknown
 */
public final class CommunicationMapper {

    private CommunicationMapper() {}

    public static List<Communication> buildAll(JsonNode root) {
        List<Communication> out = new ArrayList<>();
        if (root == null || !root.isArray()) return out;
        for (JsonNode item : root) {
            out.add(buildOne(item));
        }
        return out;
    }

    public static Communication buildOne(JsonNode item) {
        Communication c = new Communication();

        // id (numeric in source -> string in FHIR)
        if (item.hasNonNull("id")) {
            c.setId(item.get("id").asText());
        }

        // status (required, 1..1)
        c.setStatus(mapStatus(text(item, "readStatus")));

        // topic (thread title)
        String topic = text(item, "threadTitle");
        if (topic != null) {
            c.setTopic(new CodeableConcept().setText(topic));
        }

        // category (thread label, e.g. "Information", "Ärendet avslutat")
        String label = text(item, "threadLabel");
        if (label != null) {
            c.addCategory(new CodeableConcept().setText(label));
        }

        // sent (messageDate -> sent timestamp)
        if (isPresent(item, "messageDate")) {
            c.setSentElement(new DateTimeType(item.get("messageDate").asText()));
        }

        // sender = facility (Organization)
        String facilityName = text(item, "facilityName");
        String facilityHsaId = text(item, "facilityHsaId");
        if (facilityName != null || facilityHsaId != null) {
            Reference sender = new Reference().setType("Organization");
            if (facilityName != null) sender.setDisplay(facilityName);
            if (facilityHsaId != null) {
                sender.setIdentifier(new Identifier()
                    .setSystem(HSA_ID_SYSTEM)
                    .setValue(facilityHsaId));
            }
            c.setSender(sender);
        }

        // recipient = patient
        c.addRecipient(new Reference(PATIENT_REFERENCE));

        // identifier from messageUrl (so clients can deep-link back to 1177)
        String messageUrl = text(item, "messageUrl");
        if (messageUrl != null) {
            c.addIdentifier(new Identifier()
                .setSystem(INBOX_URL_SYSTEM)
                .setValue(messageUrl));
            c.addNote(new Annotation().setText("Original 1177 inbox URL: " + messageUrl));
        }

        // payload (subject + body) — present only when full message has been fetched
        String title = text(item, "title");
        if (title != null) {
            c.addPayload(new Communication.CommunicationPayloadComponent()
                .setContent(new StringType(title)));
        }
        String body = text(item, "messageText");
        if (body != null) {
            c.addPayload(new Communication.CommunicationPayloadComponent()
                .setContent(new StringType(body)));
        }

        // extensions for the rest
        if (item.hasNonNull("favorite")) {
            c.addExtension()
                .setUrl(FAVORITE_EXT_URL)
                .setValue(new BooleanType(item.get("favorite").asBoolean()));
        }
        if (item.hasNonNull("messagesInThread")) {
            c.addExtension()
                .setUrl(THREAD_COUNT_EXT_URL)
                .setValue(new IntegerType(item.get("messagesInThread").asInt()));
        }
        if (item.hasNonNull("hasAttachment")) {
            c.addExtension()
                .setUrl(HAS_ATTACHMENT_EXT_URL)
                .setValue(new BooleanType(item.get("hasAttachment").asBoolean()));
        }

        return c;
    }

    private static Communication.CommunicationStatus mapStatus(String s) {
        if (s == null) return Communication.CommunicationStatus.UNKNOWN;
        return switch (s.toUpperCase(Locale.ROOT)) {
            case "READ", "SENT" -> Communication.CommunicationStatus.COMPLETED;
            case "UNREAD" -> Communication.CommunicationStatus.INPROGRESS;
            case "NOT_SENT", "NOTSENT" -> Communication.CommunicationStatus.PREPARATION;
            default -> Communication.CommunicationStatus.UNKNOWN;
        };
    }
}
