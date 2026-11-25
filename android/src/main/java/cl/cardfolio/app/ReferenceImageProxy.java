package cl.cardfolio.app;

import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;

final class ReferenceImageProxy {
    private static final int MAX_BYTES = 3_000_000;

    private ReferenceImageProxy() { }

    static WebResourceResponse load(Uri uri) {
        String set = uri.getQueryParameter("set");
        String number = uri.getQueryParameter("number");
        if (set == null || number == null || !set.matches("[a-zA-Z0-9-]{1,24}") || !number.matches("[a-zA-Z0-9-]{1,16}")) return null;

        HttpURLConnection connection = null;
        try {
            URL target = new URL("https://images.pokemontcg.io/" + set + "/" + number + ".png");
            connection = (HttpURLConnection) target.openConnection();
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "image/png");
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK ||
                    !"images.pokemontcg.io".equalsIgnoreCase(connection.getURL().getHost()) ||
                    !connection.getContentType().toLowerCase().startsWith("image/")) return null;
            if (connection.getContentLengthLong() > MAX_BYTES) return null;
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (bytes.size() + read > MAX_BYTES) return null;
                    bytes.write(buffer, 0, read);
                }
            }
            return new WebResourceResponse("image/png", "binary", 200, "OK",
                    Collections.singletonMap("Cache-Control", "public, max-age=604800"),
                    new ByteArrayInputStream(bytes.toByteArray()));
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
