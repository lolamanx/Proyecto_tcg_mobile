package cl.cardfolio.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.Collections;

public final class CardfolioActivity extends Activity {
    private static final Uri HOME = Uri.parse("https://appassets.androidplatform.net/");
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int CAMERA_PERMISSION = 1;
    private static final int PICK_IMAGE = 2;
    private WebView web;
    private TextRecognizer recognizer;
    private PermissionRequest cameraRequest;
    private ValueCallback<Uri[]> imagePicker;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        setContentView(web);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (local(url) && "/api/market".equals(url.getPath())) return Market.lookup(CardfolioActivity.this, url);
                if (local(url) && "/api/card-image".equals(url.getPath())) return Market.image(url);
                return assets.shouldInterceptRequest(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (local(request.getUrl())) return false;
                if (request.isForMainFrame() && "https".equals(request.getUrl().getScheme())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                    } catch (ActivityNotFoundException ignored) {
                        // The device may have no browser.
                    }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (cameraRequest != null || !local(request.getOrigin()) ||
                        !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    cameraRequest = request;
                    requestPermissions(new String[] {Manifest.permission.CAMERA}, CAMERA_PERMISSION);
                }
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (cameraRequest == request) cameraRequest = null;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (imagePicker != null) imagePicker.onReceiveValue(null);
                imagePicker = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT)
                        .addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                try {
                    startActivityForResult(pick, PICK_IMAGE);
                } catch (ActivityNotFoundException error) {
                    imagePicker = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "CardfolioAndroid", Collections.singleton(ORIGIN),
                    (view, message, source, mainFrame, reply) -> {
                        if (local(source) && mainFrame) scan(message.getData(), reply);
                    });
        }
        web.loadUrl(HOME.buildUpon().appendPath("index.html").build().toString());
    }

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOME.getHost().equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private void scan(String message, JavaScriptReplyProxy reply) {
        if (message == null || message.length() > 7_000_000) return;
        int id = -1;
        try {
            JSONObject request = new JSONObject(message);
            id = request.getInt("id");
            String data = request.getString("jpeg");
            String prefix = "data:image/jpeg;base64,";
            if (!data.startsWith(prefix)) throw new IllegalArgumentException();
            byte[] bytes = Base64.decode(data.substring(prefix.length()), Base64.DEFAULT);
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth < 1 || bounds.outHeight < 1 || bounds.outWidth > 2000 ||
                    bounds.outHeight > 2000 || !"image/jpeg".equals(bounds.outMimeType)) {
                throw new IllegalArgumentException();
            }
            Bitmap photo = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (photo == null) throw new IllegalArgumentException();
            int requestId = id;
            recognizer.process(InputImage.fromBitmap(photo, 0))
                    .addOnSuccessListener(result -> send(reply, requestId, result.getText()))
                    .addOnFailureListener(error -> send(reply, requestId, null))
                    .addOnCompleteListener(task -> photo.recycle());
        } catch (JSONException | IllegalArgumentException error) {
            send(reply, id, null);
        }
    }

    private static void send(JavaScriptReplyProxy reply, int id, String text) {
        reply.postMessage("{\"id\":" + id + ",\"text\":" + (text == null ? "null" : JSONObject.quote(text)) + "}");
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != CAMERA_PERMISSION || cameraRequest == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            cameraRequest.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            cameraRequest.deny();
        }
        cameraRequest = null;
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != PICK_IMAGE || imagePicker == null) return;
        imagePicker.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null
                ? new Uri[] {data.getData()} : null);
        imagePicker = null;
    }

    @Override
    protected void onDestroy() {
        if (cameraRequest != null) cameraRequest.deny();
        if (imagePicker != null) imagePicker.onReceiveValue(null);
        recognizer.close();
        web.destroy();
        super.onDestroy();
    }
}
