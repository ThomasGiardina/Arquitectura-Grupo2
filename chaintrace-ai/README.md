# 🔗 ChainTrace-AI

Sistema de **trazabilidad de productos perecederos** (alimentos refrigerados) que combina:

- una **blockchain permisionada propia**, que guarda cada evento de la cadena de suministro de forma inmutable y verificable, y
- un **modelo de Machine Learning tradicional** (RandomForest), que predice en cada etapa el riesgo de que el producto llegue en mal estado.

Todo corre **100 % local**: sin wallets, sin criptomonedas, sin API keys ni servicios externos.

Trabajo práctico de la materia Arquitectura de Aplicaciones.

---

## Arquitectura

```
 Actores / Sensores (simulados)
 Productor · Transportista · Almacén · Minorista
 temperatura · humedad · demora · distancia
              │
              ▼
 ┌──────────────────────────────┐
 │        API REST (FastAPI)    │  main.py — orquestador
 └──────┬───────────────┬───────┘
        │ 1) predice     │ 2) registra (datos + predicción)
        ▼               ▼
 ┌──────────────┐  ┌──────────────────────┐
 │ Modelo de ML │  │ Blockchain           │
 │ RandomForest │  │ SHA-256 + PoW        │
 │ ml_model.py  │  │ blockchain.py        │
 └──────────────┘  └──────────────────────┘
              │
              ▼
 Frontend / Dashboard (static/: index.html + styles.css + app.js)
 historial como cadena de bloques · validación · simulación de ataque
```

Flujo de un checkpoint: el actor envía las lecturas → la API consulta **primero** al modelo de ML → **después** guarda el evento completo (datos + riesgo predicho) como un bloque nuevo, encadenado al anterior.

---

## Instalación y ejecución

Requisitos: Python 3.9 o superior (recomendado 3.11+).

### macOS / Linux

```bash
cd chaintrace-ai
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend
uvicorn main:app --reload
```

### Windows (PowerShell)

```powershell
cd chaintrace-ai
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd backend
uvicorn main:app --reload
```

Después abrir **http://localhost:8000** en el navegador.
La documentación interactiva de la API está en **http://localhost:8000/docs**.

> La primera vez que arranca, si no existe `model.joblib`, el modelo se entrena solo (tarda unos segundos) y muestra en consola la exactitud y la importancia de cada variable.

### Tests

```bash
cd backend
pytest -v
```

---

## Archivos

| Archivo | Qué hace |
|---|---|
| `backend/main.py` | API FastAPI. Define los endpoints, valida la entrada con Pydantic, orquesta ML → blockchain y sirve el frontend. |
| `backend/blockchain.py` | Blockchain propia: creación y minado de bloques, validación de la cadena, persistencia en `chain.json` y la función `tamper()` para la demo. |
| `backend/ml_model.py` | Genera el dataset sintético, entrena el RandomForest, lo guarda en `model.joblib` y expone `predict()` y `model_info()`. |
| `backend/static/index.html` | Estructura del dashboard: sidebar, encabezado e íconos SVG. |
| `backend/static/styles.css` | Estilos del dashboard (tema oscuro verde azulado, responsive). |
| `backend/static/app.js` | Lógica del dashboard en JS vanilla (sin build). Siete secciones: Resumen, Productos, Checkpoints, Blockchain, Modelo ML, Demo y Ayuda (preguntas frecuentes y guías). |
| `backend/static/tour.js` | Guías de cada sección: el botón **?** (abajo a la derecha) explica paso a paso la sección actual. |
| `backend/static/vendor/driver/` | [Driver.js](https://driverjs.com) 1.3.6 (licencia MIT), la librería de las guías. Está copiada en el proyecto para que funcione sin internet. |
| `backend/test_api.py` | Pruebas de punta a punta con pytest y el TestClient de FastAPI. |
| `backend/requirements.txt` | Dependencias. |

Archivos generados en tiempo de ejecución (no se versionan): `model.joblib` y `chain.json`.

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/productos` | Alta de producto (bloque `ALTA`). 409 si el id ya existe. |
| GET | `/api/productos` | Productos con su último riesgo y cantidad de bloques. |
| GET | `/api/productos/{id}/historial` | Bloques del producto, en orden. |
| POST | `/api/checkpoints` | Nuevo checkpoint: predice el riesgo y lo registra como bloque. |
| GET | `/api/blockchain/validar` | Valida toda la cadena. |
| POST | `/api/blockchain/manipular/{index}` | **Demo**: altera un bloque sin recalcular su hash. |
| POST | `/api/demo/escenario` | Carga 5 lotes de ejemplo; el primero (leche) tiene el recorrido completo con la falla de frío. |
| POST | `/api/demo/reset` | Reinicia la cadena. |
| GET | `/api/blockchain` | Cadena completa (todos los bloques). |
| GET | `/api/modelo/info` | Exactitud e importancia de variables del modelo. |
| POST | `/api/modelo/predecir` | Predice el riesgo de unas lecturas **sin** registrarlas (predicción en vivo). |
| POST | `/api/modelo/entrenar` | Reentrena el modelo y devuelve las métricas. |

---

## Cómo funciona la blockchain

1. **Bloques encadenados por hash.** Cada bloque guarda índice, timestamp, producto, actor, tipo de evento, datos, predicción, el **hash del bloque anterior** y su propio hash SHA-256. El hash se calcula sobre todo el contenido del bloque (en JSON canónico).
2. **Prueba de trabajo liviana.** Para "minar" un bloque se prueba con distintos `nonce` hasta que el hash empiece con `000`. Ilustra el concepto de minado sin hacer lenta la demo.
3. **Validación.** `is_valid()` recorre toda la cadena y verifica en cada bloque que:
   - el hash recalculado coincida con el guardado (nadie tocó el contenido),
   - el hash cumpla la prueba de trabajo,
   - `previous_hash` coincida con el hash real del bloque anterior (nadie rompió el enlace).

Si alguien modifica un dato viejo, el hash de ese bloque ya no coincide con su contenido y la validación indica **exactamente qué bloque** fue alterado. Para "tapar" el cambio habría que recalcular ese bloque y todos los siguientes, y en una red real los demás participantes tienen su propia copia de la cadena, así que no coincidiría con la de ellos.

### ¿Por qué una blockchain permisionada propia y no Ethereum?

- En trazabilidad de cadenas de suministro los participantes son **conocidos y autorizados** (productores, transportistas, almacenes). No hace falta una red pública ni minería competitiva, sino un libro mayor compartido e inmutable. Por eso la industria usa redes permisionadas (IBM Food Trust y Walmart con Hyperledger Fabric).
- Ethereum implicaría wallets, gas, testnets y claves privadas, una complejidad operativa que no aporta nada al problema.
- Una implementación propia reproduce el mecanismo esencial (inmutabilidad y detección de manipulaciones) y se puede explicar completa en una presentación.

### ¿Por qué ML tradicional y no un LLM?

- El problema es **clasificar datos numéricos tabulares** (4 variables de sensores en 3 clases de riesgo). Es una clasificación clásica, no una tarea de generar texto.
- Un RandomForest es liviano, se entrena en segundos, no necesita GPU ni internet, y es **interpretable**: se puede ver qué variables pesan más.
- Un LLM sería sobredimensionado, menos preciso con datos tabulares, y agregaría costo y dependencia de una API externa.

### Sobre el modelo

El dataset es **sintético** (4.000 muestras): temperatura segura entre 2 y 8 °C, humedad ideal entre 40 y 60 %, penalización por demora y distancia, más ruido gaussiano. Las clases bajo/medio/alto quedan balanceadas. La exactitud es la de un prototipo con datos simulados; con datos reales de sensores habría que reentrenarlo.

---

## Guion de demo (3 minutos)

La sección **Demo** de la sidebar tiene estos mismos pasos con botones.

1. **(0:00) Contexto.** Abrir http://localhost:8000 en **Resumen**. El banner está en verde: la cadena es íntegra.
2. **(0:20) Cargar escenario.** En **Demo**, click en **"Cargar escenario demo"**. Se cargan 5 lotes en distintas etapas (se ven en **Productos**). El protagonista es `LOTE-001` (Leche entera 1L), con su recorrido completo: alta + 4 checkpoints.
3. **(0:45) Recorrer la cadena.** En **Resumen** se ve la línea de tiempo del lote. El **Transporte** tiene 14 °C, 85 % de humedad y 6 h de demora, y el modelo marca **riesgo ALTO**. El Almacén recibe el producto todavía tibio (MEDIO) y el Minorista vuelve a la normalidad (BAJO).
4. **(1:15) Predicción en vivo.** En **Checkpoints**, cambiar la temperatura del formulario (por ejemplo de 5 a 14 °C) y mostrar cómo cambia la predicción del modelo en tiempo real.
5. **(1:45) Bloques y hashes.** En **Blockchain**, mostrar que el *hash previo* de cada bloque es el *hash* del anterior, y el detalle de un bloque (nonce, hash SHA-256, datos).
6. **(2:10) Simular ataque.** "Alguien con acceso a la base de datos quiere ocultar la falla de frío." Seleccionar el bloque del Transportista y click en **"Simular ataque"**: la temperatura pasa a 4 °C y el riesgo a "bajo".
7. **(2:30) Detección.** El banner se pone **rojo**: *"El bloque #3 fue alterado: su contenido ya no coincide con su hash"*, y el bloque queda marcado. Además, la tarjeta de alertas de riesgo alto baja a 0: en una base de datos común la alerta habría desaparecido sin que nadie lo note.
8. **(2:50) Cierre.** Mostrar **Modelo ML** (exactitud e importancia de variables) y `/docs`. Para volver a empezar: **"Reiniciar demo"**.
