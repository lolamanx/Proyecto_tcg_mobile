export function compareFoil(first, second, width = 96, height = 134) {
  let stable = 0;
  let clipped = 0;
  const zones = [{ hits: 0, samples: 0 }, { hits: 0, samples: 0 }];
  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      const i = (y * width + x) * 4;
      const j = i + 12;
      const lum = (pixels, index) => (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
      const a = lum(first, i);
      const b = lum(second, i);
      if (b > 246 && a < 210) clipped++;
      const edge = a - lum(first, j);
      if (Math.abs(edge) > 24 && Math.abs(edge - (b - lum(second, j))) < 22) stable++;
      if (x < width * .12 || x > width * .88) continue;
      const zone = y > height * .19 && y < height * .53 ? zones[0]
        : y > height * .59 && y < height * .86 ? zones[1] : null;
      if (!zone) continue;
      zone.samples++;
      const shifts = [0, 1, 2].map(channel => second[i + channel] - first[i + channel]);
      if (Math.abs(a - b) > 16 && Math.max(...shifts) - Math.min(...shifts) > 36 && b < 246 && a < 246) zone.hits++;
    }
  }
  if (stable < width * height * .02 || clipped > width * height * .045) return '';
  const [art, body] = zones.map(zone => zone.hits / zone.samples);
  if (art > .055 && art > body * 2.8) return 'holo';
  if (body > .055 && body > art * 2.8) return 'reverse';
  return '';
}

export function reflectionPixels(canvas) {
  const sample = document.createElement('canvas');
  sample.width = 96;
  sample.height = 134;
  const ctx = sample.getContext('2d');
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  return ctx.getImageData(0, 0, sample.width, sample.height).data;
}

export function openCamera(dialog, hint, onCapture) {
  const video = dialog.querySelector('video');
  const guide = dialog.querySelector('.camera-guide');
  const shutter = dialog.querySelector('.shutter');
  const status = dialog.querySelector('.camera-status');
  let stream;
  let active = true;
  const stop = () => {
    active = false;
    stream?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  };
  dialog.addEventListener('close', stop, { once: true });
  status.textContent = hint;
  shutter.disabled = true;
  dialog.showModal();
  navigator.mediaDevices.getUserMedia({
    audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } },
  }).then(async result => {
    stream = result;
    if (!active || !dialog.open || !dialog.isConnected) return stop();
    video.srcObject = stream;
    await video.play();
    if (active) shutter.disabled = false;
  }).catch(() => {
    stop();
    status.textContent = 'No se pudo abrir la cámara. Cierra esta ventana y usa Subir foto.';
  });
  shutter.onclick = () => {
    const box = video.getBoundingClientRect();
    const frame = guide.getBoundingClientRect();
    const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
    const left = (frame.x - box.x + (video.videoWidth * scale - box.width) / 2) / scale;
    const top = (frame.y - box.y + (video.videoHeight * scale - box.height) / 2) / scale;
    const width = frame.width / scale;
    const height = frame.height / scale;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.min(1100, Math.round(width)));
    canvas.height = Math.round(canvas.width * height / width);
    canvas.getContext('2d').drawImage(video, left, top, width, height, 0, 0, canvas.width, canvas.height);
    stop();
    dialog.close();
    onCapture(canvas);
  };
  return stop;
}
