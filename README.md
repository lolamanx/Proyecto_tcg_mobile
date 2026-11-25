# Cardfolio

App web instalable para registrar y consultar una colección de Pokémon TCG. La colección, las miniaturas y las referencias anotadas se guardan en el navegador del dispositivo. El mismo navegador y origen web deben usarse para volver a verlas.

## Ejecutar

Requiere Node.js 24 o posterior y Tesseract con los datos de idioma `eng`. No hay dependencias npm externas.

```sh
tesseract --list-langs
npm test
npm start
```

El servidor usa el puerto `3000` y acepta `PORT` para cambiarlo. En redes que requieren proxy, inicia con `NODE_USE_ENV_PROXY=1 npm start`. Para usar la app en el teléfono y añadirla a la pantalla de inicio, sírvela mediante HTTPS.

## Instalar en el teléfono

Abre la URL HTTPS de Cardfolio y toca **Instalar app**. En Chrome para Android también se puede instalar desde el menú ⋮. En iPhone, abre la URL en Safari y elige **Compartir → Agregar a pantalla de inicio**. Mantén la misma URL para conservar el acceso a la colección de ese origen.

En Codex Cloud puedes agregar el puerto **3000** en **Editar entorno → HTTP Previews** y aplicar el cambio a este chat. La depuración inalámbrica de Android sirve para probar APK desde un computador, pero Cardfolio se instala desde el navegador como PWA y no requiere configurar ADB.

## Flujos

- **Registrar carta.** Encuadra la carta con la cámara trasera. La app recorta la imagen y hace una segunda lectura OCR de la franja inferior. Elige la coincidencia de catálogo y confirma idioma, acabado y cantidad. También puedes buscar por nombre, número o edición. La foto se redimensiona antes de enviarse al servidor para OCR y solo la miniatura que decidas guardar queda en la colección.
- **Consultar carta.** Busca por foto o texto y confirma la versión. Se compara la edición, el número, el idioma y el acabado. El catálogo puede sugerir un acabado cuando documenta uno solo. Cuando documenta varios, la app muestra las opciones. Después de usar la cámara guiada, **Comprobar reflejo** permite tomar una segunda foto con una leve inclinación. La comparación de color se realiza en el teléfono y puede sugerir holo o reverse holo. Confirma con la carta si el resultado es dudoso o si hay varios acabados posibles.
- **Precios.** TCGplayer en USD se consulta mediante `api.pokemontcg.io` para cartas en inglés que tienen precio publicado para el acabado seleccionado. `POKEMONTCG_API_KEY` es opcional para solicitudes al API. Puedes abrir TCGMatch Chile para anotar un valor en CLP con su fuente y fecha. Cardmarket también está disponible como enlace. La app no convierte USD en CLP ni presenta precios de otra versión.
- **Sin conexión.** Una vez cargada, la app puede abrir la colección y buscar en el catálogo local. El escáner y la consulta automática de precios necesitan llegar al servidor. Las imágenes de referencia requieren acceso a `images.pokemontcg.io`.

## Catálogo

Los datos base proceden de [Pokémon TCG Data](https://github.com/PokemonTCG/pokemon-tcg-data). La información de acabados y los nombres alternativos proceden de [TCGdex](https://github.com/tcgdex/cards-database) bajo [su licencia MIT](TCGdex-LICENSE). El catálogo incluido cubre ediciones internacionales representadas en la fuente base. Las ediciones exclusivas de Japón y otros mercados asiáticos pueden quedar fuera aunque la app permita registrar esos idiomas.

Para actualizarlo, descarga los tarballs de ambas fuentes y ejecuta `python3 scripts/build-catalog.py pokemon-tcg-data.tar.gz cards-database.tar.gz`.

## APK para Android

La app Android usa los mismos archivos de interfaz y catálogo. El APK incluye OCR latino de ML Kit y el análisis de foil funciona en el dispositivo. Los precios automáticos en USD consultan la fuente por HTTPS. La colección del APK empieza separada de la colección de una instalación web.

En Android Studio, abre la carpeta `android/` e instala Android SDK 35 y Build Tools 35.0.0. Para compilar el APK de prueba con Gradle 8.9 y Java 17 o posterior:

```sh
cd android
./gradlew assembleDebug
```

El APK de prueba se genera en `android/build/outputs/apk/debug/`. Descárgalo y ábrelo en Android usando Archivos. Si el teléfono pide permiso, habilita **Instalar apps desconocidas** para Archivos durante la instalación. Puedes deshabilitarlo al terminar. Para distribuir futuras actualizaciones, genera una versión de producción firmada con tu propia clave y conserva esa clave de forma segura. Android requiere la misma firma para actualizar una instalación existente.
