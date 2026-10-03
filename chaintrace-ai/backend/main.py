"""
main.py — API REST de ChainTrace-AI (FastAPI).

Es el orquestador central: recibe los checkpoints de los actores, consulta
PRIMERO al modelo de ML para obtener el riesgo, y DESPUÉS registra el evento
(datos + predicción) como un bloque nuevo en la blockchain.
También sirve el frontend (carpeta static/).

Ejecutar desde esta carpeta:  uvicorn main:app --reload
Documentación automática:     http://localhost:8000/docs
"""

import os
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import ml_model
from blockchain import Blockchain

app = FastAPI(
    title="ChainTrace-AI",
    description="Trazabilidad de productos perecederos con blockchain permisionada y ML",
    version="1.0",
)

chain = Blockchain()
ml_model.load()  # entrena el modelo al arrancar si todavía no existe model.joblib

Actor = Literal["Productor", "Transportista", "Almacén", "Minorista"]


# ---------- Modelos de entrada (Pydantic valida tipos automáticamente) ----------

class ProductoIn(BaseModel):
    id: str = Field(..., min_length=1, examples=["LOTE-001"])
    nombre: str = Field(..., min_length=1, examples=["Leche entera 1L"])
    origen: str = Field(..., min_length=1, examples=["Tambo La Esperanza"])


class LecturasIn(BaseModel):
    temperatura: float = Field(..., description="°C")
    humedad: float = Field(..., ge=0, le=100, description="%")
    demora_horas: float = Field(..., ge=0, description="Demora respecto al tiempo esperado")
    distancia_km: float = Field(..., ge=0, description="Distancia recorrida en la etapa")


class CheckpointIn(LecturasIn):
    producto_id: str
    actor: Actor


# ---------- Lógica compartida ----------

def crear_producto(p: ProductoIn) -> dict:
    if chain.product_exists(p.id):
        raise HTTPException(409, f"Ya existe un producto con id '{p.id}'")
    return chain.add_block(
        product_id=p.id,
        actor="Productor",
        event_type="ALTA",
        data={"nombre": p.nombre, "origen": p.origen},
    )


def registrar_checkpoint(c: CheckpointIn) -> dict:
    if not chain.product_exists(c.producto_id):
        raise HTTPException(404, f"No existe el producto '{c.producto_id}'")
    datos = {
        "temperatura": c.temperatura,
        "humedad": c.humedad,
        "demora_horas": c.demora_horas,
        "distancia_km": c.distancia_km,
    }
    # 1) Primero el modelo de ML evalúa el riesgo...
    prediccion = ml_model.predict(**datos)
    # 2) ...y después el evento completo queda registrado de forma inmutable.
    return chain.add_block(
        product_id=c.producto_id,
        actor=c.actor,
        event_type="CHECKPOINT",
        data=datos,
        prediction=prediccion,
    )


# ---------- Endpoints de productos ----------

@app.post("/api/productos", tags=["Productos"], status_code=201)
def alta_producto(p: ProductoIn):
    return crear_producto(p)


@app.get("/api/productos", tags=["Productos"])
def listar_productos():
    productos = {}
    for b in chain.chain:
        pid = b["product_id"]
        if pid is None:
            continue  # bloque génesis
        if b["event_type"] == "ALTA":
            productos[pid] = {
                "id": pid,
                "nombre": b["data"].get("nombre"),
                "origen": b["data"].get("origen"),
                "bloques": 0,
                "ultimo_riesgo": None,
            }
        if pid in productos:
            productos[pid]["bloques"] += 1
            if b["prediction"]:
                productos[pid]["ultimo_riesgo"] = b["prediction"]["nivel"]
    return list(productos.values())


@app.get("/api/productos/{producto_id}/historial", tags=["Productos"])
def historial(producto_id: str):
    if not chain.product_exists(producto_id):
        raise HTTPException(404, f"No existe el producto '{producto_id}'")
    return chain.product_history(producto_id)


@app.post("/api/checkpoints", tags=["Checkpoints"], status_code=201)
def agregar_checkpoint(c: CheckpointIn):
    return registrar_checkpoint(c)


# ---------- Endpoints de blockchain ----------

@app.get("/api/blockchain", tags=["Blockchain"])
def cadena_completa():
    return chain.chain


@app.get("/api/blockchain/validar", tags=["Blockchain"])
def validar():
    resultado = chain.is_valid()
    resultado["bloques"] = len(chain.chain)
    return resultado


@app.post("/api/blockchain/manipular/{index}", tags=["Demo"])
def manipular(index: int):
    """SOLO DEMO: altera un bloque ya minado sin recalcular su hash."""
    try:
        bloque = chain.tamper(index)
    except IndexError as e:
        raise HTTPException(404, str(e))
    return {"mensaje": f"Bloque #{index} manipulado", "bloque": bloque}


# ---------- Demo ----------

def lectura(actor, temperatura, humedad, demora_horas, distancia_km):
    return {"actor": actor, "temperatura": temperatura, "humedad": humedad,
            "demora_horas": demora_horas, "distancia_km": distancia_km}


# Lotes del escenario de demo. Todos los riesgos se verificaron con el modelo real.
# El primero es el protagonista de la demo: el Transportista tiene una falla de
# refrigeración (ALTO), el Almacén lo recibe todavía tibio (MEDIO) y en el
# Minorista se recupera la cadena de frío (BAJO). Como se carga primero, su
# checkpoint del Transportista queda en el bloque #3 (el que se ataca en la demo).
# Los demás están en distintas etapas del recorrido, con riesgos variados.
ESCENARIO_DEMO = [
    {
        "nombre": "Leche entera 1L", "origen": "Tambo La Esperanza (Rafaela, Santa Fe)",
        "checkpoints": [
            lectura("Productor",     4.0,  50.0, 0.5, 20.0),    # bajo
            lectura("Transportista", 14.0, 85.0, 6.0, 400.0),   # alto: falla de frío
            lectura("Almacén",       11.0, 70.0, 4.0, 150.0),   # medio
            lectura("Minorista",     5.0,  55.0, 1.0, 15.0),    # bajo
        ],
    },
    {
        "nombre": "Yogur bebible 1L", "origen": "Tambo San José (Sunchales, Santa Fe)",
        "checkpoints": [
            lectura("Productor",     4.5, 52.0, 0.5, 25.0),     # bajo
            lectura("Transportista", 5.5, 55.0, 1.0, 180.0),    # bajo
            lectura("Almacén",       4.0, 48.0, 0.5, 30.0),     # bajo
        ],
    },
    {
        "nombre": "Queso fresco 500 g", "origen": "Cooperativa El Roble (Tandil, Buenos Aires)",
        "checkpoints": [
            lectura("Productor",     4.0,  50.0, 0.5, 15.0),    # bajo
            lectura("Transportista", 11.5, 68.0, 3.0, 220.0),   # medio: camión con demora
        ],
    },
    {
        "nombre": "Jugo de naranja 1L", "origen": "Finca Los Pinos (Concordia, Entre Ríos)",
        "checkpoints": [
            lectura("Productor",     5.0,  50.0, 0.5, 40.0),    # bajo
            lectura("Transportista", 6.0,  55.0, 1.5, 260.0),   # bajo
            lectura("Almacén",       13.0, 78.0, 5.0, 60.0),    # alto: falla la cámara de frío
        ],
    },
    {
        "nombre": "Manteca 200 g", "origen": "Tambo La Esperanza (Rafaela, Santa Fe)",
        "checkpoints": [
            lectura("Productor",     3.5, 45.0, 0.5, 10.0),     # bajo
        ],
    },
]


def siguiente_id_lote() -> str:
    n = 1
    while chain.product_exists(f"LOTE-{n:03d}"):
        n += 1
    return f"LOTE-{n:03d}"


@app.post("/api/demo/escenario", tags=["Demo"])
def cargar_escenario():
    ids = []
    for lote in ESCENARIO_DEMO:
        pid = siguiente_id_lote()
        crear_producto(ProductoIn(id=pid, nombre=lote["nombre"], origen=lote["origen"]))
        for cp in lote["checkpoints"]:
            registrar_checkpoint(CheckpointIn(producto_id=pid, **cp))
        ids.append(pid)
    principal = ids[0]  # el lote de leche, protagonista de la demo
    return {"producto_id": principal, "productos": ids, "historial": chain.product_history(principal)}


@app.post("/api/demo/reset", tags=["Demo"])
def reset():
    chain.reset()
    return {"mensaje": "Cadena reiniciada", "bloques": len(chain.chain)}


# ---------- Modelo ----------

@app.get("/api/modelo/info", tags=["Modelo ML"])
def modelo_info():
    return ml_model.model_info()


@app.post("/api/modelo/predecir", tags=["Modelo ML"])
def modelo_predecir(l: LecturasIn):
    """Predice el riesgo de unas lecturas SIN registrarlas en la blockchain
    (lo usa el formulario de checkpoints para mostrar la predicción en vivo)."""
    return ml_model.predict(l.temperatura, l.humedad, l.demora_horas, l.distancia_km)


@app.post("/api/modelo/entrenar", tags=["Modelo ML"])
def modelo_entrenar():
    """Reentrena el modelo con el dataset sintético y devuelve las métricas nuevas."""
    ml_model.train()
    return ml_model.model_info()


@app.middleware("http")
async def sin_cache(request, call_next):
    """Evita que el navegador use versiones viejas del frontend después de editarlo."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"
    return response


# El frontend se monta al final para que las rutas /api tengan prioridad.
app.mount(
    "/",
    StaticFiles(directory=os.path.join(os.path.dirname(os.path.abspath(__file__)), "static"), html=True),
    name="static",
)
