/* ============================================================
   ChainTrace-AI — recorridos guiados con Driver.js

   El botón "?" (abajo a la derecha) explica la sección que se está viendo.
   Cada paso resalta un elemento marcado con data-tour="..." en app.js.
   Driver.js está guardado en vendor/driver/ para que funcione sin internet.
   ============================================================ */

"use strict";

/** Paso que resalta el elemento [data-tour=nombre] */
const tourPaso = (nombre, title, description, side = "bottom") =>
  ({ element: `[data-tour="${nombre}"]`, popover: { title, description, side, align: "start" } });

/** Paso sin elemento: se muestra centrado en la pantalla */
const tourIntro = (title, description) => ({ popover: { title, description } });

const TOURS = {
  resumen: [
    tourIntro("Resumen", "Es la vista general del sistema: el estado de la blockchain, los indicadores principales y el recorrido del lote que se está siguiendo."),
    tourPaso("banner", "Integridad de la cadena", "Recalcula el hash SHA-256 de cada bloque y verifica que esté enlazado con el anterior. En verde la cadena está íntegra; si alguien alteró un dato, se pone en rojo e indica el bloque exacto."),
    tourPaso("stats", "Indicadores", "Cantidad de productos y de checkpoints registrados en la blockchain, y cuántos checkpoints recibieron riesgo ALTO del modelo de Machine Learning."),
    tourPaso("actividad", "Actividad reciente", "Cada evento del lote es un bloque de la blockchain. El color indica el riesgo que predijo el modelo en esa etapa. Hacé click en un evento para ver su bloque.", "right"),
    tourPaso("accesos", "Accesos rápidos", "Atajos para cargar el escenario de demo, registrar un checkpoint o ir al explorador de la blockchain.", "left"),
    tourPaso("lote", "Lote monitoreado", "El riesgo actual es el que predijo el modelo en el último checkpoint; la etapa actual es el último actor que registró un evento.", "left"),
  ],

  productos: [
    tourIntro("Productos", "Acá se registran y consultan los lotes. Cada lote nace con un bloque de ALTA en la blockchain."),
    tourPaso("stats", "Indicadores", "Total de lotes, cuántos tienen riesgo ALTO en su último checkpoint y cuántos orígenes distintos hay."),
    tourPaso("listado", "Listado de productos", "Buscá por lote, nombre u origen. La etapa y el riesgo salen de los bloques de cada lote. Hacé click en una fila para ver su detalle.", "right"),
    tourPaso("alta", "Alta de producto", "Registra un lote nuevo: la API crea un bloque de tipo ALTA, lo mina (prueba de trabajo: el hash tiene que empezar con 000) y lo encadena al último bloque. Si el ID ya existe, la API lo rechaza.", "left"),
    tourPaso("lote", "Detalle", "Resumen del lote seleccionado: su riesgo y la etapa en la que está.", "left"),
  ],

  checkpoints: [
    tourIntro("Checkpoints", "Un checkpoint es una lectura de sensores en una etapa de la cadena de frío. En el prototipo, el formulario simula los sensores IoT."),
    tourPaso("stats", "Indicadores", "Checkpoints registrados hoy, cuántos tuvieron riesgo ALTO y la temperatura promedio de todas las lecturas (el rango seguro es de 2 a 8 °C)."),
    tourPaso("form-cp", "Nuevo checkpoint", "Elegí el lote y el actor, y cargá temperatura, humedad, demora y distancia. Al registrar, la API primero le pide la predicción al modelo y después guarda datos + predicción como un bloque nuevo.", "right"),
    tourPaso("prediccion", "Predicción en vivo", "Mientras escribís, el modelo RandomForest predice el riesgo sin registrar nada. La confianza es la probabilidad que el modelo le asigna a ese nivel. Abajo, las variables que más pesan en sus decisiones.", "left"),
    tourPaso("ultimos", "Últimos checkpoints", "Los eventos más recientes de todos los lotes. Hacé click en uno para ver su bloque en la blockchain.", "left"),
  ],

  blockchain: [
    tourIntro("Blockchain", "La blockchain es un libro mayor compartido: cada bloque guarda el hash del anterior, así que modificar un dato viejo rompe la cadena y se detecta."),
    tourPaso("banner", "Validación", "Recorre todos los bloques y verifica tres cosas: que el hash coincida con el contenido, que cumpla la prueba de trabajo (empieza con 000) y que apunte al hash real del bloque anterior."),
    tourPaso("explorador", "Explorador de bloques", "Todos los bloques en orden. El #0 es el génesis, el primero de la cadena. Hacé click en uno para ver su detalle.", "right"),
    tourPaso("detalle-bloque", "Detalle del bloque", "El hash es la huella digital del bloque: si cambia un solo dato, cambia por completo. El hash previo es el hash del bloque anterior: ese es el enlace que forma la cadena.", "left"),
    tourPaso("acciones", "Probar la cadena", "Validar cadena vuelve a verificar todo. Simular ataque modifica el bloque seleccionado sin recalcular su hash, como alguien que edita una base de datos común: la validación lo detecta enseguida.", "left"),
  ],

  modelo: [
    tourIntro("Modelo ML", "El riesgo de cada checkpoint lo predice un modelo de Machine Learning tradicional: un RandomForest de scikit-learn."),
    tourPaso("stats", "El modelo en números", "Exactitud en el conjunto de prueba, cantidad de árboles del bosque, profundidad máxima de cada árbol y muestras del dataset (80 % para entrenar y 20 % para evaluar)."),
    tourPaso("desempeno", "Desempeño", "La exactitud es el porcentaje de lecturas de prueba que el modelo clasificó bien. Reentrenar vuelve a generar el dataset y a entrenar el bosque.", "right"),
    tourPaso("importancia", "Importancia de variables", "Cuánto usa el bosque cada variable para decidir. La temperatura es la que más pesa, lo esperable en una cadena de frío.", "left"),
    tourPaso("interpreta", "Cómo interpreta el riesgo", "Las reglas de cadena de frío con las que se generó el dataset. El modelo no las conoce: las aprende a partir de los datos, que además tienen ruido.", "top"),
    tourPaso("limitaciones", "Limitaciones", "Es un prototipo entrenado con datos sintéticos. Para usarlo en serio habría que reentrenarlo con lecturas reales de sensores.", "top"),
  ],

  demo: [
    tourIntro("Demo", "Un recorrido guiado para mostrar el sistema funcionando en la presentación, en unos 3 minutos."),
    tourPaso("banner-demo", "Escenario de demo", "Carga 5 lotes de ejemplo. El protagonista es un lote de leche cuyo transporte sufre una falla de frío. Reiniciar demo deja la blockchain solo con el bloque génesis."),
    tourPaso("pasos", "Pasos de la demo", "Seguilos en orden. Cada paso se marca solo cuando lo completás: cargar el lote, revisar los checkpoints, ver el riesgo alto, simular el ataque y validar la cadena.", "right"),
    tourPaso("lote-ejemplo", "Lote del ejemplo", "El recorrido del lote. Cada círculo toma el color del riesgo que predijo el modelo en esa etapa: el transporte sale en rojo por la falla de frío.", "left"),
    { element: ".resultado", popover: { title: "Resultado", description: "Antes del ataque muestra lo que se espera. Después, el resultado real de la validación: qué bloque fue alterado y por qué.", side: "left", align: "start" } },
    tourPaso("accesos-demo", "Accesos rápidos", "Para saltar a otras secciones durante la presentación.", "top"),
  ],

  ayuda: [
    tourIntro("Ayuda", "Todo lo necesario para entender el sistema y responder preguntas en la presentación."),
    tourPaso("flujo", "Cómo funciona", "El recorrido de un dato: lectura de sensores, predicción del modelo, registro en la blockchain, validación y consulta.", "right"),
    tourPaso("guias", "Guías por sección", "Cada botón te lleva a una sección y arranca su guía paso a paso.", "left"),
    tourPaso("faq", "Preguntas frecuentes", "Las preguntas más probables sobre los datos, la blockchain y el modelo. Tocá una para ver la respuesta.", "top"),
  ],
};

/** Arranca el recorrido de la sección actual (solo con los pasos cuyo elemento existe) */
function iniciarTour() {
  const crear = window.driver?.js?.driver;
  if (!crear) return toast("No se pudo cargar la guía (Driver.js)");
  const pasos = (TOURS[vistaActual()] || []).filter(p => !p.element || document.querySelector(p.element));
  const tour = crear({
    steps: pasos,
    showProgress: true,
    progressText: "{{current}} de {{total}}",
    nextBtnText: "Siguiente",
    prevBtnText: "Anterior",
    doneBtnText: "Listo",
    popoverClass: "ct-tour",
    overlayColor: "#020a0c",
    overlayOpacity: 0.7,
    stagePadding: 6,
    stageRadius: 14,
    smoothScroll: true,
  });
  tour.drive();
}
