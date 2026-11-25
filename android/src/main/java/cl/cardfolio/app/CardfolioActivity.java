package cl.cardfolio.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

public final class CardfolioActivity extends Activity {
    private static final Uri HOME = Uri.parse("https://appassets.androidplatform.net/");
    private static final int CAMERA_PERMISSION = 1;
    private static final int PICK_IMAGE = 2;
    private WebView web;
    private PermissionRequest cameraRequest;
    private ValueCallback<Uri[]> imagePicker;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        setContentView(web);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("appassets.androidplatform.net".equals(url.getHost()) &&
                        "/api/reference-image".equals(url.getPath())) {
                    android.webkit.WebResourceResponse image = ReferenceImageProxy.load(url);
                    if (image != null) return image;
                }
                if ("appassets.androidplatform.net".equals(url.getHost()) && url.getPath().endsWith(".mjs")) {
                    try {
                        return new android.webkit.WebResourceResponse("text/javascript", "UTF-8",
                                getAssets().open(url.getPath().substring(1)));
                    } catch (Exception ignored) { }
                }
                return assets.shouldInterceptRequest(url);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("appassets.androidplatform.net".equals(url.getHost())) return false;
                if (request.isForMainFrame() && "https".equals(url.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
                    catch (ActivityNotFoundException ignored) { }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                if (!"appassets.androidplatform.net".equals(request.getOrigin().getHost()) || cameraRequest != null) {
                    request.deny(); return;
                }
                boolean video = false;
                for (String resource : request.getResources()) video |= PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource);
                if (!video) { request.deny(); return; }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    cameraRequest = request;
                    requestPermissions(new String[] {Manifest.permission.CAMERA}, CAMERA_PERMISSION);
                }
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (cameraRequest == request) cameraRequest = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (imagePicker != null) imagePicker.onReceiveValue(null);
                imagePicker = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                try { startActivityForResult(pick, PICK_IMAGE); }
                catch (ActivityNotFoundException error) { imagePicker = null; callback.onReceiveValue(null); }
                return true;
            }
        });
        web.loadUrl(HOME.buildUpon().appendPath("index.html").build().toString());
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != CAMERA_PERMISSION || cameraRequest == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED)
            cameraRequest.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else cameraRequest.deny();
        cameraRequest = null;
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != PICK_IMAGE || imagePicker == null) return;
        imagePicker.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[] {data.getData()} : null);
        imagePicker = null;
    }

    @Override protected void onDestroy() {
        if (cameraRequest != null) cameraRequest.deny();
        if (imagePicker != null) imagePicker.onReceiveValue(null);
        web.destroy();
        super.onDestroy();
    }
}
