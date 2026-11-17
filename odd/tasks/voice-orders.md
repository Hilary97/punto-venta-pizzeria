# Pedido por voz (intérprete + confirmación)

El mesero dicta el pedido completo ("dos cocas y una grande de pepperoni"), el sistema lo interpreta contra el catálogo real y muestra una pantalla de confirmación; nada entra al pedido sin confirmar.
Branch: feat/voice-orders (stacked on main). Primera rebanada SIN captura de audio: el texto llega tipeado o dictado con el micrófono del teclado de iOS.

## Contexto técnico (medido, no supuesto)

- No existe nada de voz en el repo: `grep -ri "voice|voz|speech|SpeechRecognition|getUserMedia|microphone|whisper"` en `src/` = 0 resultados. No hay dependencia de audio en `package.json`.
- El reconocimiento de voz del navegador en iPhone/iPad es poco confiable, sobre todo en PWA instalada (esta app ya es PWA: `vite-plugin-pwa` + service worker). Por eso la primera rebanada no depende del micrófono del navegador.
- La app no tiene backend propio: `vercel.json` solo reescribe a `/index.html`, no hay `api/`. Un endpoint de transcripción sería infraestructura nueva + secreto + costo.
- Aditivo a lo existente: `addToDraft` / `addPizzaToDraft` (`src/features/orders/domain/orderDraft.ts:19,55`), `describePizza` (`src/features/pizza/domain/pizza.ts:212`), `fold` accento-insensible (`src/features/orders/domain/orderFilter.ts:9`).
- Variantes de producto son nombres, no ids (`Product.variants: string[]`, `src/features/products/domain/product.ts:19`); el servidor rechaza una línea sin variante cuando el producto las tiene (`supabase/migrations/20261006120000_product_variants.sql:122-147`).
- El catálogo del dispositivo de mesero llega SIN precios (`priceCents: 0`, `src/features/orders/infrastructure/ordersSources.ts:42-61`): el intérprete nunca calcula precio.

## Specs

- S1: User: "dejarlo para después, ahorita quiero implementar la funcionalidad de hacer pedidos por voz, revise memorias y hay algo de eso" — alcance elegido (verbatim de la opción): "Armar el pedido completo por voz" ("dos cocas y una grande de pepperoni" → 2× Coca-Cola + 1× Pizza Grande Pepperoni → pantalla de confirmación antes de sumar) en dispositivo elegido (verbatim): "iPhone / iPad".
- S2: User eligió (verbatim de la opción): "Arrancar sin audio: intérprete + confirmación (recomendado)" — "El mesero escribe o dicta con el micrófono del teclado de iOS sobre un campo, nosotros interpretamos ese texto en líneas del ticket y mostramos la pantalla de confirmación. Cero infra nueva, cero costo, funciona en cualquier device, hoy." La captura de audio propia queda fuera de esta feature.
- S3: Intérprete determinista y sin red: `parseSpokenOrder(text, context)` en `src/features/orders/domain/voiceOrder.ts` es una función pura (mismo texto + mismo catálogo = mismo resultado), sin llamadas de red, sin IA remota, sin tocar el borrador. Recibe los productos activos (con sus variantes) y el `PizzaCatalog`.
- S4: Cantidades: dígitos ("2 cocas", "2x coca"), palabras de uno a doce ("un/una, dos, tres, …, doce"), y " xN " al final. Sin cantidad explícita = 1. Un segmento del dictado produce una sola línea con su cantidad.
- S5: Segmentación: un pedido se parte en líneas por coma, punto y coma, " y ", " más ", y salto de línea. " con " NO separa (vive dentro de nombres como "Hamburguesa con papas").
- S6: Productos: se busca el nombre del producto sin acentos ni mayúsculas y tolerando singular/plural ("cocas" → "Coca-Cola"); si el texto no coincide completo, se acepta el primer token del nombre cuando identifica a UN solo producto del catálogo. Varias coincidencias NO se adivinan: la línea queda en `pickProduct` con las opciones para que el mesero elija.
- S7: Pizza: una línea de pizza necesita tamaño (nombre del `PizzaSize`, p. ej. "grande") y estilo (nombre del `PizzaStyle` con o sin el prefijo "Estilo", p. ej. "pepperoni" → "Estilo Pepperoni"). Se arma un `PizzaConfig` de una porción sin ingredientes ni extras y su nombre es el que devuelve `describePizza` (el mismo que guarda el servidor). Mitades, ingredientes y extras NO se interpretan en esta rebanada: si aparecen, la línea es `unknown` con un motivo que manda a "Armar pizza".
- S8: Variantes: si el producto tiene variantes y el dictado nombra una ("alitas búfalo"), se fija; si tiene variantes y no se nombró ninguna, la línea es `missingVariant` con las opciones, porque el servidor rechaza la línea sin variante.
- S9: Nada se descarta en silencio: las palabras que no se usaron para identificar producto/tamaño/estilo/variante se devuelven como nota propuesta de esa línea (recortada a 200 caracteres); un segmento que no coincide con nada se devuelve como `unknown` con el texto tal cual se escuchó y un motivo. Una línea sin cantidad, sin nota y sin coincidencia nunca "desaparece".
- S10: Pantalla de confirmación: el botón "Pedido por voz" vive en el paso Productos y abre un campo de texto libre; al interpretar se muestran las líneas propuestas con su cantidad ajustable, las decisiones pendientes (elegir producto / elegir variante) y las que no se entendieron. Solo "Agregar al pedido" toca el borrador, y solo con las líneas completas; "Cancelar" lo deja intacto. El intérprete no calcula precios; el servidor cotiza después, como hoy.

## Tasks

- T1 (S3-S9) — `voiceOrder.ts` + tests de tabla (cantidades, acentos/plurales, ambigüedad, variantes, pizza, notas sobrantes, desconocidos). Route: gentle-ai-worker (context backstop en el parent). Done: contrato de tests escrito por el parent; RED observado (módulo inexistente) -> GREEN 18/18; tsc 0; oxlint 0 en los archivos. Commit: `c07f04a`.
- T2 (S10) — UI de confirmación montada en el paso Productos (OrdersWorkspace) + tests de la pantalla y de que el borrador no cambia sin confirmar. Route: gentle-ai-worker. Done: VoiceOrderSheet.tsx nuevo, "Pedido por voz" en ProductsStep, handler en OrdersWorkspace; RED 2 archivos (botón/módulo inexistente) -> GREEN 99/99 en esos dos archivos; tsc 0; oxlint 12 (baseline); build OK. El worker reportó como riesgo que addToDraft fusiona y el id generado se pierde. Commit: `249696f`.
- T2b (S10) — defecto encontrado al revisar el riesgo de T2 y reproducido con test: con una línea del mismo producto sin nota ya en el borrador, la nota dictada se perdía y la cantidad quedaba corta. Nuevo helper puro addVoiceLines en orderDraft.ts (fusiona solo líneas sin nota; lo demás se agrega con su cantidad completa) y el handler pasa a una sola actualización. Route: inline. Done: RED 6/7 (helper inexistente) -> GREEN 7/7 voiceDraft + 134/134 en los cuatro archivos tocados; tsc 0; oxlint limpio en lo tocado; suite completa 1525/1525 y build OK. Commit: `249696f`.
- T3 (S1-S10) — verificación independiente (S1-S10) y README. Route: gentle-ai-verify (una ronda de corrección). Done: primera ronda FAIL con 3 defectos reales que los tests del parent no atrapaban (guard de ingredientes corría antes de matchear estilo, "más" acentuado no separaba, pickProduct devolvía variant null y el servidor rechazaba el pedido). Corregidos con tests de regresión propios (voiceOrder.realCatalog.test.ts + uno de sheet) y re-verificación independiente PASS en los tres, más addVoiceLines PASS y alcance del borrador PASS. Advisory NFD cerrado por el parent (normalize NFC antes de separar) con su test. 1524 tests, tsc 0, oxlint 12 (ninguno en los archivos tocados), build OK. No se adoptaron los 4 archivos de probes del verificador: su cobertura ya está en los tests de regresión y duplicaba casos. Commit: `249696f` (README) + evidencia en este documento.

## Entrega

- Slice 1 `c07f04a`: intérprete + sus tests (~535 líneas, unas 250 son tests y ~120 el documento).
- Slice 2 `249696f`: confirmación + arreglo del merge + tests + README (~753 líneas).
- Total ~1295 líneas: por encima de la rebanada revisable de ~400. Si se abre PR, partirlo en dos encadenados (1 -> 2), o revisar con este documento como guía.

## Log

- L1: User (verbatim): "dejarlo para después, ahorita quiero implementar la funcionalidad de hacer pedidos por voz, revise memorias y hay algo de eso" — (la primera parte se refiere a los atajos de notas por categoría, que quedan para después).
- L2: Memoria y código revisados: ninguna decisión ni código previo de voz en este proyecto; los hits de "audio" en memoria son de proyectos de invitaciones de boda.
- L3: User eligió alcance (verbatim de la opción): "Armar el pedido completo por voz" y dispositivo (verbatim): "iPhone / iPad".
- L4: Research (fuentes: caniuse speech-recognition, bug 321436 de WebKit, issues de PWA en iOS): Safari soporta `webkitSpeechRecognition` con soporte parcial; en PWA instalada falla el permiso de micrófono, `onresult` no dispara, hay loops de crash en iPad, y `continuous` no se respeta. Se lo reporté al usuario junto con las tres alternativas de captura.
- L5: User eligió (verbatim de la opción): "Arrancar sin audio: intérprete + confirmación (recomendado)".
- L6: Exploración delegada (gentle-ai-explore) del dominio del pedido y del catálogo: contratos de `addToDraft`/`addPizzaToDraft`, variantes como nombres, catálogo sin precios en el dispositivo, y que no existe parser de texto libre ni alias.
- L7: Delegación de T1 y T2 a gentle-ai-worker por el backstop de contexto del parent; el parent revisó el riesgo reportado en T2 y encontró el defecto de fusión (T2b), reproducido con test antes de arreglarlo.
- L8: Verificación independiente ronda 1: FAIL por 3 defectos (S1/S5/S6/S7/S8) con evidencia de sonda sobre datos de semilla reales; ronda de corrección del worker con RED->GREEN por defecto y re-verificación ronda 2: PASS en los tres + PASS de addVoiceLines + PASS de alcance (sin precios, un solo camino al borrador). Advisory NFD (solo texto pegado en NFD) cerrado por el parent. Suite completa 1524/1524, build OK.
- L9: Commits hechos en la rama feat/voice-orders (c07f04a, 249696f). La rebanada total supera las ~400 líneas: queda anotado el límite de cada slice para que la entrega se parta si se abre PR. Push, PR y merge quedan a decisión del usuario.
