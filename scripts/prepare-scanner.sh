#!/usr/bin/env bash
set -euo pipefail
deps=$(mktemp -d)
trap 'rm -rf "$deps"' EXIT
npm install --prefix "$deps" --ignore-scripts --no-audit --no-fund @techstark/opencv-js@4.10.0-release.1 tesseract.js@5.1.1 tesseract.js-core@5.1.1
mkdir -p public/ocr public/data
cp "$deps/node_modules/@techstark/opencv-js/dist/opencv.js" public/ocr/
cp -r data/90f27d0 public/data/
cp "$deps"/node_modules/tesseract.js/dist/{worker.min.js,tesseract.min.js} public/ocr/
cp "$deps"/node_modules/tesseract.js-core/tesseract-core-lstm.wasm* public/ocr/
cp /usr/share/tesseract-ocr/5/tessdata/{eng,jpn}.traineddata public/ocr/
cp "$deps"/node_modules/tesseract.js/LICENSE* public/ocr/
printf '{}\n' >public/ocr/ready.json
