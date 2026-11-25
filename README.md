# Cardfolio

Aplicación web instalable para registrar y consultar cartas Pokémon TCG. Esta versión se creó como una base nueva, centrada en el escáner y la colección.

## Probar en el computador

Requiere Node.js 20 o posterior:

```bash
npm start
```

Abre `http://localhost:4173`. Para usar la cámara del teléfono, publica la app con HTTPS. El navegador solicitará permiso para usar la cámara.

## Flujo de uso

1. En **Escanear**, activa la cámara o elige una foto. El escáner revisa el pie de la carta con OCR en intervalos cortos.
2. La app busca el número y el nombre en el catálogo local, muestra referencias visuales y te pide confirmar edición, idioma y acabado.
3. Guarda la copia en el dispositivo. Desde **Colección** puedes buscar cartas y ajustar cantidades.
4. En la ficha puedes abrir TCGplayer, Cardmarket y TCGMatch Chile. Si anotas un precio CLP, se guarda junto a la carta con fuente y fecha.

## Privacidad y funcionamiento sin conexión

Las fotos de la carta se leen dentro del navegador y no se suben a un servidor. El motor OCR y su modelo de idioma se descargan de un CDN al primer uso del escáner; por eso la primera lectura necesita internet. Las imágenes de referencia también requieren internet. La colección y los precios anotados quedan en `localStorage` de ese navegador. La interfaz y el catálogo incluido se guardan para uso sin conexión después de abrir la app.

La app no consulta precios automáticamente ni convierte moneda: no hay una cuota de API mensual ni valores de mercado inventados. Los enlaces permiten comparar precios publicados; la cotización CLP es la que anotes manualmente.

## Android

La misma interfaz se incluye en `public/` para compilarla como APK con el contenedor Android del repositorio. El flujo de compilación de GitHub Actions adjunta un APK de prueba a cada actualización de `main`. Para compilar localmente, abre `android/` en Android Studio o ejecuta `./gradlew assembleDebug` desde esa carpeta.

## Catálogo de cartas

`catalog.json` trae seis cartas reales como demostración. El escáner buscará únicamente dentro de las cartas listadas allí. Para la siguiente etapa conviene generar un catálogo completo a partir de un conjunto de datos abierto y guardarlo como archivo local; la interfaz ya busca sobre ese catálogo sin llamadas por cada escaneo.

El pequeño catálogo sigue el formato de Pokémon TCG Data y las imágenes de referencia se enlazan desde `images.pokemontcg.io`. Las imágenes no se empaquetan en esta primera versión.

## Próximos pasos recomendados

- Incorporar el catálogo completo de cartas, ediciones, idiomas y acabados.
- Añadir clasificación de acabados con un segundo ángulo de captura y confirmación manual.
- Importar precios de fuentes que permitan reutilización y mostrar moneda, fecha y condición por separado.
- Exportar e importar la colección como JSON antes de añadir sincronización entre dispositivos.

## Estructura

- `index.html`, `style.css`, `app.js`: interfaz y flujo de captura.
- `catalog.json`: catálogo local (ahora, de demostración).
- `sw.js`, `manifest.webmanifest`: instalación PWA y shell sin conexión.
- `server.mjs`: servidor estático local sin dependencias externas.
