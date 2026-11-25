# Pizza builder en una sola pantalla (tabs de porción)

Quitar el flujo de pasos del armador de pizzas: tamaño y división fijos arriba, tabs de porción y
solo la porción activa debajo, con el resumen y "Agregar pizza" siempre visibles.
Branch: feat/pizza-builder-tabs. Layout aprobado: design/pizza-builder-tabs/01-tabs-porcion.html
Builder: src/features/pizza/ui/PizzaBuilderModal.tsx (también lo usa Admin > Pizzas rápidas "Fijar pizza").

## Specs

- S1: User: "Tengo en mente mejorar en pedidos armar pizza, podriamos mejorar implentar el acomod en pasos mas rapido que sea mas legible y rapido armar una pizza, podriamos implementar todo en una sola interfaz si hacer pasos ?" — objetivo: armar una pizza sin navegar pasos, con una sola interfaz legible a 375 px.
- S2: User eligió: "B · Una pantalla con parciales en tabs (recomendada)" — tamaño y división fijos arriba; tabs de porción ("Mitad 1 | Mitad 2") que muestran el estilo elegido como subtítulo; debajo solo el contenido de la porción activa; Extras y Notas en acordeones; footer fijo con resumen, cantidad y "Agregar pizza".
- S3: User eligió: "01 · Tabs de porción" — el layout a implementar es `design/pizza-builder-tabs/01-tabs-porcion.html`; el artboard 02 queda como alternativa descartada.
- S4: Se conserva lo ya aprobado por el usuario en estas mismas pantallas y un rediseño no puede romperlo: el builder abre sin tamaño marcado ("Elige el tamaño", botón deshabilitado); los tamaños agotados quedan deshabilitados con "Agotado" y los que tienen masas muestran "Quedan N"; la división arranca en Entera y cambiarla conserva los estilos ya elegidos; elegir un estilo sin ingredientes a elección pasa solo a la siguiente porción sin estilo; las taps sobre el contenido recién cambiado se ignoran 150 ms; el footer muestra el resumen vivo y la cantidad; "Fijar pizza" (admin) sigue sin cantidad ni notas.
- S5: Ya no hay botones "Siguiente" ni "← Atrás" entre porciones ni header de pasos: cada porción es un tab y cuesta un tap. La fila "+ Extras en {porción}" de las porciones que un avance automático dejó atrás deja de existir porque el tab de esa porción está siempre a un tap; sus ingredientes cargados como extra se agregan desde el tab.
- S6: Sin tamaño elegido no se muestra la porción: la pantalla muestra solo el selector de tamaño y el footer pide "Elige el tamaño" con el botón deshabilitado. Al tocar un tamaño aparece la división y el tab de la porción 1, sin navegar.

## Tasks

- T1 (S1-S3, S5-S6) — reescribir PizzaBuilderModal como una sola pantalla: chips de tamaño, chips de división, tabs de porción con subtítulo de estilo, porción activa (estilos + elección de ingredientes), acordeón de notas y footer fijo. Quitar `Step`, header de pasos, "Siguiente"/"← Atrás" y `extraStops`. Route: inline. Done: el componente bajó de 488 a ~430 líneas; los extras para toda la pizza quedan visibles sin tamaño elegido. Commit: `c620911`.
- T2 (S4) — conservar los contratos existentes: sin tamaño marcado, agotados con hint, Entera por defecto, división que conserva estilos, avance automático a la siguiente porción sin estilo + guard de 150 ms, resumen vivo, cantidad, `quickPick` sin cantidad ni notas. Route: inline. Done: cubiertos por el suite nuevo (ver T3). Commit: `c620911`.
- T3 — reescribir PizzaBuilderModal.test.tsx contra el nuevo contrato. Route: inline. Done: 64/64 en el archivo; suite completa 1456/1456, tsc 0, oxlint 12 (ninguno en los archivos tocados), build OK. También se adaptaron 2 tests de `OrdersPage.test.tsx` que entraban por el builder y ahora abren la disclosure "Notas". Commit: `c620911` (código+tests+docs en `0988cd6`).
  - Slice: 2319 líneas autoradas en 2 commits (c620911, 0988cd6), muy por encima de las ~400 recomendadas. La causa es que el suite del builder se reescribió entero contra el contrato nuevo; partirlo más dejaría commits con tests rojos. Si se publica como PR, conviene avisarle al revisor que el diff es una reescritura, no adiciones, o partirlo en PRs encadenados.
- T4 — revisar a 375 px en claro y oscuro. Route: user (teléfono). Pendiente: no hay navegador headless en el proyecto; el usuario lo mira en su teléfono como en las iteraciones anteriores. Commit: —

## Log

- L1: "Tengo en mente mejorar en pedidos armar pizza, podriamos mejorar implentar el acomod en pasos mas rapido que sea mas legible y rapido armar una pizza, podriamos implementar todo en una sola interfaz si hacer pasos ?"
- L2: Parent exploró `PizzaBuilderModal.tsx` y midió los toques reales (entera simple 4, mitades 7 con "Siguiente: Mitad 2"). Se ofrecieron tres direcciones (A hoja con scroll, B una pantalla con tabs, C quedarse en pasos). User eligió: "B · Una pantalla con parciales en tabs (recomendada)".
- L3: Parent escribió `design/pizza-builder-tabs/` (01-tabs-porcion.html, 02-tarjetas-apiladas.html, design.json) y abrió el canvas. User eligió: "01 · Tabs de porción" — se implementa ese artboard; el 02 queda como alternativa descartada.
- L4: Parent decisión técnica dentro de S2: el avance automático de S4 se mantiene igual que hoy (solo estilos sin ingredientes a elección) y ahora cambia de tab en vez de paso; el estilo con ingredientes a elección se queda en su tab porque ahí están sus checkboxes.
- L5: Implementado el artboard `design/pizza-builder-tabs/01-tabs-porcion.html` en `src/features/pizza/ui/PizzaBuilderModal.tsx`. Diferencias con el artboard, todas por legibilidad a 375 px: los estilos siguen como tarjetas verticales con descripción (no grilla de 2 columnas) porque la descripción dice qué estilos traen ingredientes a elección; las notas quedan en una disclosure cerrada por defecto y los extras para toda la pizza siempre visibles.

