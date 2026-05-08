package se.hackathon.proxy.mapping;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Tiny defensive accessors for {@link JsonNode}. Mappers consume sanitized
 * 1177 JSON where any field can be missing, null, or blank, so every read
 * goes through one of these — null-safe, blank-safe, never throws.
 */
public final class JsonNodes {

    private JsonNodes() {}

    /** True iff {@code node} has {@code field} present, non-null, and non-blank when stringified. */
    public static boolean isPresent(JsonNode node, String field) {
        return node != null && node.hasNonNull(field) && !node.get(field).asText().isBlank();
    }

    /** Returns {@code node[field]} as a string, or null if absent/blank. */
    public static String text(JsonNode node, String field) {
        return isPresent(node, field) ? node.get(field).asText() : null;
    }

    /** Returns {@code node[field]} as a boolean, or {@code fallback} if absent/null. */
    public static boolean bool(JsonNode node, String field, boolean fallback) {
        if (node == null || !node.hasNonNull(field)) return fallback;
        return node.get(field).asBoolean(fallback);
    }
}
