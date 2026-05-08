package se.hackathon.proxy.mapping;

import com.fasterxml.jackson.databind.JsonNode;
import org.hl7.fhir.r4.model.*;

import static se.hackathon.proxy.mapping.FhirConstants.COUNTY_EXT_URL;
import static se.hackathon.proxy.mapping.FhirConstants.LOGIN_METHOD_EXT_URL;
import static se.hackathon.proxy.mapping.FhirConstants.MUNICIPALITY_EXT_URL;
import static se.hackathon.proxy.mapping.FhirConstants.PATIENT_ID;
import static se.hackathon.proxy.mapping.FhirConstants.PERSONNUMMER_SYSTEM;
import static se.hackathon.proxy.mapping.JsonNodes.bool;
import static se.hackathon.proxy.mapping.JsonNodes.isPresent;
import static se.hackathon.proxy.mapping.JsonNodes.text;

/**
 * Merges 1177 sources into a single FHIR R4 Patient.
 *
 * Source priority (richest first):
 *   1. intyg /api/user                         -> personId, personName
 *   2. tidbok /api/scheduling/users/current    -> firstName, lastName, address, city, zip, phone, county/municipality, active
 *   3. e-tjanster /api/core/userprofile        -> firstName, lastName (fallback)
 *   4. bokadetider /api/user                   -> name, active (last resort)
 */
public final class PatientMapper {

    private PatientMapper() {}

    public static Patient build(JsonNode intygUser,
                                JsonNode tidbokUser,
                                JsonNode etjansterProfile,
                                JsonNode bokadetiderUser) {
        Patient patient = new Patient();
        patient.setId(PATIENT_ID);

        // --- identifier (personnummer, from intyg) ---
        if (isPresent(intygUser, "personId")) {
            patient.addIdentifier()
                .setSystem(PERSONNUMMER_SYSTEM)
                .setValue(intygUser.get("personId").asText());
        }

        // --- active ---
        boolean active = bool(tidbokUser, "active", true)
            && bool(bokadetiderUser, "active", true);
        patient.setActive(active);

        // --- name (HumanName) ---
        HumanName name = new HumanName().setUse(HumanName.NameUse.OFFICIAL);
        String firstName = firstNonBlank(
            text(tidbokUser, "firstName"),
            text(etjansterProfile, "firstName")
        );
        String lastName = firstNonBlank(
            text(tidbokUser, "lastName"),
            text(etjansterProfile, "lastName")
        );
        if (firstName != null) name.addGiven(firstName);
        if (lastName != null) name.setFamily(lastName);

        String fullText = firstNonBlank(
            text(intygUser, "personName"),
            text(tidbokUser, "name"),
            text(bokadetiderUser, "name"),
            joinNonBlank(firstName, lastName)
        );
        if (fullText != null) name.setText(fullText);

        if (firstName != null || lastName != null || fullText != null) {
            patient.addName(name);
        }

        // --- telecom (phone) ---
        String phone = text(tidbokUser, "phone");
        if (phone != null) {
            patient.addTelecom()
                .setSystem(ContactPoint.ContactPointSystem.PHONE)
                .setUse(ContactPoint.ContactPointUse.MOBILE)
                .setValue(phone);
        }

        // --- address ---
        Address addr = new Address().setUse(Address.AddressUse.HOME);
        boolean hasAddr = false;
        String street = text(tidbokUser, "address");
        if (street != null) { addr.addLine(street); hasAddr = true; }
        String city = text(tidbokUser, "city");
        if (city != null) { addr.setCity(city); hasAddr = true; }
        String zip = text(tidbokUser, "zip");
        if (zip != null) { addr.setPostalCode(zip); hasAddr = true; }

        String county = text(tidbokUser, "countyCode");
        if (county != null) {
            addr.addExtension()
                .setUrl(COUNTY_EXT_URL)
                .setValue(new StringType(county));
            hasAddr = true;
        }
        String municipality = text(tidbokUser, "municipalityCode");
        if (municipality != null) {
            addr.addExtension()
                .setUrl(MUNICIPALITY_EXT_URL)
                .setValue(new StringType(municipality));
            hasAddr = true;
        }
        if (hasAddr) patient.addAddress(addr);

        // --- login method (root extension; informational) ---
        String loginMethod = text(intygUser, "loginMethod");
        if (loginMethod != null) {
            patient.addExtension()
                .setUrl(LOGIN_METHOD_EXT_URL)
                .setValue(new CodeType(loginMethod));
        }

        return patient;
    }

    // --- name-only helpers (used here only) -------------------------------
    private static String firstNonBlank(String... candidates) {
        for (String c : candidates) if (c != null && !c.isBlank()) return c;
        return null;
    }
    private static String joinNonBlank(String a, String b) {
        if ((a == null || a.isBlank()) && (b == null || b.isBlank())) return null;
        return ((a == null ? "" : a) + " " + (b == null ? "" : b)).trim();
    }
}
