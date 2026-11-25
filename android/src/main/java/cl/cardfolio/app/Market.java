package cl.cardfolio.app;

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
    private Market() {}

    static WebResourceResponse lookup(Uri request) {
        String id = request.getQueryParameter("id");
        String finish = priceKey(request.getQueryParameter("finish"));
        String language = request.getQueryParameter("language");
        if (id == null || !id.matches("[a-zA-Z0-9]+-[a-zA-Z0-9]+") || finish == null) {
            return response(400, "Bad request", "{\"error\":\"Carta o acabado inválidos.\"}");
        }
        if (!"en".equals(language)) return response(200, "OK", "{\"reason\":\"language\"}");
        HttpURLConnection connection = null;
        try {
            URL endpoint = new URL("https://api.pokemontcg.io/v2/cards/" + id + "?select=id,tcgplayer,cardmarket");
            connection = (HttpURLConnection) endpoint.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(7000);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status == 404) return response(200, "OK", "{\"reason\":\"missing\"}");
            if (status != 200) throw new IllegalStateException();
            JSONObject data;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int size;
                while ((size = input.read(buffer)) != -1) {
                    if (output.size() + size > 262_144) throw new IllegalStateException();
                    output.write(buffer, 0, size);
                }
                data = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8)).getJSONObject("data");
            }
            JSONObject player = data.optJSONObject("tcgplayer");
            JSONObject prices = player == null ? null : player.optJSONObject("prices");
            JSONObject variant = prices == null ? null : prices.optJSONObject(finish);
            JSONObject cardmarket = data.optJSONObject("cardmarket");
            double amount = variant == null ? Double.NaN : variant.optDouble("market");
            JSONObject result = new JSONObject()
                    .put("amount", Double.isNaN(amount) || Double.isInfinite(amount) ? JSONObject.NULL : amount)
                    .put("currency", "USD")
                    .put("updated", player == null ? JSONObject.NULL : player.opt("updatedAt"))
                    .put("tcgplayer", player == null ? JSONObject.NULL : player.opt("url"))
                    .put("cardmarket", cardmarket == null ? JSONObject.NULL : cardmarket.opt("url"));
            return response(200, "OK", result.toString());
        } catch (Exception error) {
            return response(503, "Unavailable", "{\"error\":\"La fuente de precios no está disponible en este momento.\"}");
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
