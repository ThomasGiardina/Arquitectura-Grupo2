"""
test_api.py — Pruebas de punta a punta de la API.
Ejecutar desde esta carpeta:  pytest -v
"""

import pytest
from fastapi.testclient import TestClient

import main
from blockchain import Blockchain


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Cada test usa su propia cadena en un archivo temporal (no toca chain.json)
    monkeypatch.setattr(main, "chain", Blockchain(str(tmp_path / "chain.json")))
    return TestClient(main.app)


def alta(client, pid="P-1"):
    return client.post("/api/productos", json={"id": pid, "nombre": "Yogur", "origen": "Tambo X"})


def checkpoint(client, pid="P-1", actor="Transportista", temp=5.0):
    return client.post("/api/checkpoints", json={
        "producto_id": pid, "actor": actor, "temperatura": temp,
        "humedad": 50, "demora_horas": 1, "distancia_km": 50,
    })


def test_cadena_nueva_es_valida(client):
    r = client.get("/api/blockchain/validar").json()
    assert r["valido"] is True
    assert r["bloques"] == 1  # sólo el génesis


def test_alta_producto_y_duplicado(client):
    r = alta(client)
    assert r.status_code == 201
    assert r.json()["event_type"] == "ALTA"
    assert r.json()["hash"].startswith("000")  # prueba de trabajo
    assert alta(client).status_code == 409


def test_checkpoint_incluye_prediccion(client):
    alta(client)
    r = checkpoint(client)
    assert r.status_code == 201
    pred = r.json()["prediction"]
    assert pred["nivel"] in ("bajo", "medio", "alto")
    assert 0 <= pred["probabilidad"] <= 1


def test_checkpoint_validaciones(client):
    assert checkpoint(client, pid="NO-EXISTE").status_code == 404
    alta(client)
    assert checkpoint(client, actor="Hacker").status_code == 422


def test_bloques_encadenados(client):
    alta(client)
    checkpoint(client)
    hist = client.get("/api/productos/P-1/historial").json()
    assert len(hist) == 2
    assert hist[1]["previous_hash"] == hist[0]["hash"]


def test_manipulacion_detectada(client):
    alta(client)
    checkpoint(client, actor="Transportista", temp=14)
    checkpoint(client, actor="Almacén")
    assert client.get("/api/blockchain/validar").json()["valido"] is True

    # Se altera el bloque del transportista (#2) sin recalcular su hash
    assert client.post("/api/blockchain/manipular/2").status_code == 200
    r = client.get("/api/blockchain/validar").json()
    assert r["valido"] is False
    assert r["bloque"] == 2
    assert "#2" in r["motivo"]


def test_manipular_bloque_inexistente(client):
    assert client.post("/api/blockchain/manipular/99").status_code == 404


def test_escenario_demo(client):
    r = client.post("/api/demo/escenario").json()
    assert r["producto_id"] == "LOTE-001"
    niveles = {b["actor"]: b["prediction"]["nivel"] for b in r["historial"] if b["prediction"]}
    assert niveles["Transportista"] == "alto"
    assert niveles["Productor"] in ("bajo", "medio")
    assert niveles["Minorista"] in ("bajo", "medio")
    # El checkpoint del Transportista del lote principal es el bloque #3 (el que se ataca en la demo)
    assert next(b["index"] for b in r["historial"] if b["actor"] == "Transportista") == 3
    # Se cargan 5 lotes, con al menos un riesgo de cada nivel según su último checkpoint
    assert r["productos"] == ["LOTE-001", "LOTE-002", "LOTE-003", "LOTE-004", "LOTE-005"]
    ultimos = {p["id"]: p["ultimo_riesgo"] for p in client.get("/api/productos").json()}
    assert ultimos == {"LOTE-001": "bajo", "LOTE-002": "bajo", "LOTE-003": "medio", "LOTE-004": "alto", "LOTE-005": "bajo"}
    # Un segundo escenario usa ids nuevos
    assert client.post("/api/demo/escenario").json()["producto_id"] == "LOTE-006"


def test_reset(client):
    client.post("/api/demo/escenario")
    client.post("/api/blockchain/manipular/1")
    client.post("/api/demo/reset")
    r = client.get("/api/blockchain/validar").json()
    assert r["valido"] is True and r["bloques"] == 1
    assert client.get("/api/productos").json() == []


def test_modelo_info(client):
    info = client.get("/api/modelo/info").json()
    assert info["accuracy"] > 0.6
    assert set(info["importancias"]) == {"temperatura", "humedad", "demora_horas", "distancia_km"}
    assert info["muestras"] == 4000


def test_predecir_no_registra_bloque(client):
    r = client.post("/api/modelo/predecir", json={
        "temperatura": 14, "humedad": 85, "demora_horas": 6, "distancia_km": 400,
    }).json()
    assert r["nivel"] == "alto"
    assert client.get("/api/blockchain/validar").json()["bloques"] == 1
