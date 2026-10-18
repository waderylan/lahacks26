# Probar Qwen y compararlo con Jev

1. Abre Terminal en la carpeta `lahacks26` y ejecuta `npm run dev`.
2. Abre la dirección que imprime el servidor (normalmente http://localhost:5173).
3. En **Model**, elige **Qwen · Veri** o **Jev**. El cambio recarga la página y mantiene separados los juicios en memoria.
4. En **Transactions**, escribe un criterio. En **Rules**, las condiciones AI usan ese mismo modelo; ALL/ANY/NOT y las acciones siguen ejecutándose por código.

El modelo Qwen de este proyecto es el entrenamiento semántico nuevo, no el anterior selector A/B/C/D de pagos.

## Ejemplos

- `Anything electronic or tech-related`
- `Descriptions that are blank or just a placeholder`
- `Memos that contradict the description`
- `Find bills for physical goods where the memo instead describes a standing overhead charge or monthly service charge.`

Selecciona **Hearthworn Remodeling — review scenarios** para probar los escenarios modificados con etiquetas de referencia. Son ejemplos creados para la demo: no errores descubiertos en los datos originales. En la UI se muestra su declaración de modificaciones.

## Interpretación

- **Match**: el modelo considera que hay evidencia del criterio.
- **No match**: considera que la evidencia relevante contradice el criterio.
- **Uncertain**: el texto no permite decidir. No se transforma en falso al usar NOT.
- **Failed**: error de ejecución; no es una decisión y no aplica acciones.

Qwen obtiene puntuaciones de los tokens A/B/C. Si existe una calibración válida para este deployment, las ajusta usando únicamente los 220 casos sintéticos de validación y la app las identifica como ajustadas. Eso no demuestra calibración en datos reales ni equivalencia con Jev. Si no están disponibles, la app no inventa porcentajes. El costo de Qwen corresponde a tiempo de GPU, no a los dólares por solicitud del gateway.

## Comparación reproducible

- `npm run benchmark:summary` genera `COMPARISON.md` a partir de resultados guardados.
- `npm run benchmark:semantic -- qwen17` evalúa los 370 casos reservados del modelo de 1.7B (reutiliza los resultados ya guardados para esa versión).
- `npm run benchmark:workload -- qwen17` ejecuta una consulta nueva de 50 registros originales y consume tiempo de GPU. Añade `all` para los 416 registros.

El modelo puede fallar: revisa COMPARISON.md antes de usarlo como sustituto de Jev. El checkpoint y los ejemplos no garantizan generalización a cualquier criterio nuevo.

## Recursos de Veri

El despliegue ajustado usa una L4 y `min_replicas=0`, con ventana de inactividad de 300 segundos. Si el servidor duerme, la primera consulta puede indicar que está despertando; espera y reintenta. Detener un deployment en Veri es permanente para ese deployment; el checkpoint entrenado se conserva y puede desplegarse de nuevo.

Las claves están solo en `.env`, excluido de Git. No copies ese archivo a la web, al repositorio o al conjunto de entrenamiento.
