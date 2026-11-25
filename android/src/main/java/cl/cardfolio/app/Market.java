package cl.cardfolio.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

final class Market {
    private static final String PREFS = "cardfolio-market-cache";
    private static final long FRESH_MS = 24L * 60 * 60 * 1000;
    private static final long STALE_MS = 30L * 24 * 60 * 60 * 1000;
    private Market() {}

    static WebResourceResponse lookup(Context context, Uri request) {
        String id = request.getQueryParameter("id");
        String finish = priceKey(request.getQueryParameter("finish"));
        if (id == null || !id.matches("[a-zA-Z0-9]+-[a-zA-Z0-9]+") || finish == null) {
            return response(400, "Bad request", "{\"error\":\"Carta o acabado inválidos.\"}");
        }
        if (!"en".equals(request.getQueryParameter("language"))) {
            return response(200, "OK", "{\"reason\":\"language\"}");
        }
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        String saved = prefs.getString(id, null);
        JSONObject cached = null;
        long savedAt = 0;
        try {
            if (saved != null) {
                JSONObject entry = new JSONObject(saved);
                savedAt = entry.optLong("savedAt");
                cached = entry.optJSONObject("value");
                if (cached != null && now - savedAt < FRESH_MS) {
                    return withAmount(cached, finish, false);
                }
            }
        } catch (Exception ignored) {}
        HttpURLConnection connection = null;
        try {
            URL endpoint = new URL("https://api.tcgdex.net/v2/en/cards/" + id);
            connection = (HttpURLConnection) endpoint.openConnection();
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(7000);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status == 404) return response(200, "OK", "{\"reason\":\"missing\"}");
            if (status != 200) throw new IllegalStateException();
            JSONObject card;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int size;
                while ((size = input.read(buffer)) != -1) {
                    if (output.size() + size > 262_144) throw new IllegalStateException();
                    output.write(buffer, 0, size);
                }
                card = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
            }
            JSONObject pricing = card.optJSONObject("pricing");
            JSONObject player = pricing == null ? null : pricing.optJSONObject("tcgplayer");
            JSONObject prices = new JSONObject();
            for (String variant : new String[] {"normal", "holofoil", "reverseHolofoil", "1stEditionNormal", "1stEditionHolofoil"}) {
                prices.put(variant, marketPrice(player == null ? null : player.optJSONObject(variant)));
            }
            JSONObject value = new JSONObject()
                    .put("prices", prices)
                    .put("currency", player == null ? "USD" : player.optString("unit", "USD").toUpperCase())
                    .put("updated", player == null ? JSONObject.NULL : player.opt("updated"))
                    .put("tcgplayer", player == null ? JSONObject.NULL : player.opt("url"))
                    .put("cardmarket", pricing == null || pricing.optJSONObject("cardmarket") == null
                            ? JSONObject.NULL : pricing.optJSONObject("cardmarket").opt("url"))
                    .put("source", "TCGdex");
            prefs.edit().putString(id, new JSONObject().put("savedAt", now).put("value", value).toString()).apply();
            return withAmount(value, finish, false);
        } catch (Exception error) {
            if (cached != null && now - savedAt < STALE_MS) return withAmount(cached, finish, true);
            return response(503, "Unavailable", "{\"error\":\"TCGdex no está disponible y todavía no hay un precio guardado en caché.\"}");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static Object marketPrice(JSONObject record) {
        if (record == null) return JSONObject.NULL;
        double amount = record.optDouble("market", record.optDouble("marketPrice", record.optDouble("avg", Double.NaN)));
        return Double.isNaN(amount) || Double.isInfinite(amount) || amount <= 0 ? JSONObject.NULL : amount;
    }

    private static WebResourceResponse withAmount(JSONObject value, String finish, boolean stale) {
        JSONObject prices = value.optJSONObject("prices");
        JSONObject result = value;
        try {
            result.put("amount", prices == null ? JSONObject.NULL : prices.opt(finish));
            if (stale) result.put("stale", true);
        } catch (Exception ignored) {}
        return response(200, "OK", result.toString());
    }

    static WebResourceResponse image(Uri request) {
        String set = request.getQueryParameter("set");
        String number = request.getQueryParameter("number");
        if (set == null || number == null || !set.matches("[a-zA-Z0-9-]{1,24}") ||
                !number.matches("[a-zA-Z0-9-]{1,16}")) {
            return response(400, "Bad request", "{\"error\":\"Edición o número inválido.\"}");
        }
        HttpURLConnection connection = null;
        try {
            URL endpoint = new URL("https://images.pokemontcg.io/" + set + "/" + number + ".png");
            connection = (HttpURLConnection) endpoint.openConnection();
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(7000);
            connection.setRequestProperty("Accept", "image/png");
            int status = connection.getResponseCode();
            String type = connection.getContentType();
            if (status != 200 || type == null || !type.toLowerCase().startsWith("image/")) {
                return response(404, "Not found", "{\"error\":\"Imagen de referencia no disponible.\"}");
            }
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int size;
                while ((size = input.read(buffer)) != -1) {
                    if (output.size() + size > 3_000_000) return response(413, "Too large", "{}");
                    output.write(buffer, 0, size);
                }
                return new WebResourceResponse(type, null, 200, "OK",
                        Collections.singletonMap("Cache-Control", "public, max-age=86400"),
                        new ByteArrayInputStream(output.toByteArray()));
            }
        } catch (Exception error) {
            return response(503, "Unavailable", "{\"error\":\"No se pudo cargar la imagen de referencia.\"}");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String priceKey(String finish) {
        if (finish == null) return null;
        switch (finish) {
            case "normal": return "normal";
            case "holo": return "holofoil";
            case "reverse": return "reverseHolofoil";
            case "first": return "1stEditionNormal";
            case "firstHolo": return "1stEditionHolofoil";
            default: return null;
        }
    }

    private static WebResourceResponse response(int status, String reason, String json) {
        return new WebResourceResponse("application/json", "UTF-8", status, reason,
                Collections.singletonMap("Cache-Control", "no-store"),
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
    }
}
