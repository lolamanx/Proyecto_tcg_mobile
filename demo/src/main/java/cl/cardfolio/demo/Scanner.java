package cl.cardfolio.demo;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.widget.*;
import androidx.activity.ComponentActivity;
import androidx.camera.core.*;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.regex.*;

public class Scanner extends ComponentActivity {
    private static final Pattern NUMBER = Pattern.compile("(?i)(?<![A-Z0-9])([A-Z]{0,3}[0-9]{1,3}[a-z]?)\\s*/\\s*([A-Z]{0,3}[0-9]{1,3})(?![A-Z0-9])");
    private PreviewView preview;
    private TextView status;
    private Button permission, save, collection;
    private TextRecognizer reader;
    private String candidate = "";
    private long lastFrame;
    private boolean errorShown;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(16 * getResources().getDisplayMetrics().density);
        page.setPadding(pad,pad,pad,pad);
        TextView title = new TextView(this);
        title.setText("Escáner de cartas");
        title.setTextSize(26);
        page.addView(title);
        preview = new PreviewView(this);
        page.addView(preview, new LinearLayout.LayoutParams(-1,0,1));
        status = new TextView(this);
        status.setTextSize(18);
        page.addView(status);
        permission = new Button(this);
        permission.setText("Permitir cámara");
        permission.setOnClickListener(v -> requestPermissions(new String[]{Manifest.permission.CAMERA},1));
        page.addView(permission);
        save = new Button(this);
        save.setText("Guardar lectura");
        save.setEnabled(false);
        save.setOnClickListener(v -> {
            String entries = getPreferences(0).getString("entries","");
            getPreferences(0).edit().putString("entries",candidate+"\n"+entries).apply();
            status.setText("Guardado: "+candidate);
            save.setEnabled(false);
            count();
        });
        page.addView(save);
        collection = new Button(this);
        collection.setOnClickListener(v -> {
            String entries = getPreferences(0).getString("entries","").trim();
            new android.app.AlertDialog.Builder(this).setTitle("Mis lecturas")
                .setItems(entries.isEmpty()? new String[]{"Todavía no hay lecturas"} : entries.split("\n"), null)
                .setPositiveButton("Volver",null).show();
        });
        page.addView(collection);
        count();
        setContentView(page);
        ready();
        if (state == null && permission.getVisibility() == View.VISIBLE) permission.performClick();
    }

    private void count() {
        String entries = getPreferences(0).getString("entries","").trim();
        collection.setText("Mis lecturas ("+(entries.isEmpty()?0:entries.split("\n").length)+")");
    }

    @Override public void onRequestPermissionsResult(int code,String[] names,int[] results) {
        super.onRequestPermissionsResult(code,names,results);
        if (code==1) ready();
    }

    private void ready() {
        if (checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED) {
            status.setText("Permite el uso de la cámara para leer una carta.");
            return;
        }
        permission.setVisibility(View.GONE);
        status.setText("Muestra el número de una carta, por ejemplo 170/264.");
        ListenableFuture<ProcessCameraProvider> camera = ProcessCameraProvider.getInstance(this);
        camera.addListener(() -> {
            if (isDestroyed()) return;
            try {
                ProcessCameraProvider provider = camera.get();
                Preview live = new Preview.Builder().build();
                live.setSurfaceProvider(preview.getSurfaceProvider());
                ImageAnalysis frames = new ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build();
                reader = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                frames.setAnalyzer(ContextCompat.getMainExecutor(this), this::read);
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, live,frames);
            } catch (Exception e) { status.setText("No se pudo iniciar la cámara trasera."); }
        },ContextCompat.getMainExecutor(this));
    }

    @androidx.camera.core.ExperimentalGetImage
    private void read(ImageProxy frame) {
        long now = SystemClock.elapsedRealtime();
        if (frame.getImage()==null || now-lastFrame<500 || isDestroyed()) { frame.close(); return; }
        lastFrame=now;
        InputImage image=InputImage.fromMediaImage(frame.getImage(),frame.getImageInfo().getRotationDegrees());
        reader.process(image).addOnSuccessListener(text -> {
            Matcher match=NUMBER.matcher(text.getText());
            if (match.find()) {
                String number=match.group(1)+"/"+match.group(2);
                if (!number.equals(candidate)) {
                    candidate=number;
                    status.setText("Número leído: "+number);
                    save.setEnabled(true);
                }
            } else {
                candidate="";
                save.setEnabled(false);
                status.setText("Acerca la carta hasta que se lea su número.");
            }
        }).addOnFailureListener(e -> {
            candidate="";
            save.setEnabled(false);
            if (!errorShown) { status.setText("No se pudo leer la imagen."); errorShown=true; }
        }).addOnCompleteListener(task -> frame.close());
    }

    @Override public void onDestroy() {
        if (reader!=null) reader.close();
        super.onDestroy();
    }
}
