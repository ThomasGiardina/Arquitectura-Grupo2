"""
ml_model.py — Modelo de Machine Learning de ChainTrace-AI.

Problema: a partir de 4 lecturas de sensores de un checkpoint, predecir si el
producto corre riesgo BAJO, MEDIO o ALTO de llegar en mal estado.
Es una clasificación clásica sobre datos tabulares, por eso se usa un
RandomForestClassifier (ML tradicional) y no un modelo generativo.

Como no tenemos datos reales, se genera un dataset sintético con una regla
inspirada en la cadena de frío, más ruido aleatorio para que el modelo tenga
que aprender el patrón (y no sea un simple if/else).
"""

import os
from typing import Optional

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split

MODEL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.joblib")

FEATURES = ["temperatura", "humedad", "demora_horas", "distancia_km"]
CLASSES = ["bajo", "medio", "alto"]

N_ESTIMATORS = 200
MAX_DEPTH = 8

# Cache en memoria para no leer el archivo en cada predicción
_bundle: Optional[dict] = None


def generate_dataset(n: int = 4000, seed: int = 42):
    """Genera n lecturas de sensores simuladas y su nivel de riesgo."""
    rng = np.random.default_rng(seed)

    temperatura = rng.uniform(-2, 20, n)      # °C
    humedad = rng.uniform(20, 95, n)          # %
    demora_horas = rng.exponential(3, n).clip(0, 24)
    distancia_km = rng.uniform(5, 1200, n)

    # --- Score de riesgo continuo (regla de cadena de frío) ---
    # Temperatura segura: entre 2 y 8 °C. Cada grado fuera del rango suma riesgo.
    fuera_temp = np.maximum(0, temperatura - 8) + np.maximum(0, 2 - temperatura)
    # Humedad ideal: entre 40 y 60 %.
    fuera_hum = np.maximum(0, humedad - 60) + np.maximum(0, 40 - humedad)

    score = (
        0.9 * fuera_temp
        + 0.06 * fuera_hum
        + 0.25 * demora_horas
        + 0.0012 * distancia_km
    )
    # Ruido gaussiano: dos lecturas iguales no siempre terminan igual (como en la realidad)
    score = score + rng.normal(0, 1.0, n)

    # Umbrales elegidos con percentiles para que las 3 clases queden balanceadas
    t1, t2 = np.percentile(score, [33, 66])
    y = np.where(score < t1, "bajo", np.where(score < t2, "medio", "alto"))

    X = np.column_stack([temperatura, humedad, demora_horas, distancia_km])
    return X, y


def train(verbose: bool = True) -> dict:
    """Entrena el modelo, calcula métricas y lo guarda en model.joblib."""
    X, y = generate_dataset()
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    model = RandomForestClassifier(
        n_estimators=N_ESTIMATORS, max_depth=MAX_DEPTH, random_state=42
    )
    model.fit(X_train, y_train)

    accuracy = float(accuracy_score(y_test, model.predict(X_test)))
    importancias = {
        f: round(float(imp), 4) for f, imp in zip(FEATURES, model.feature_importances_)
    }

    bundle = {
        "model": model,
        "accuracy": accuracy,
        "importancias": importancias,
        "muestras": int(len(X)),
    }
    joblib.dump(bundle, MODEL_FILE)
    global _bundle
    _bundle = bundle  # el modelo nuevo pasa a usarse en las próximas predicciones

    if verbose:
        print("=== Modelo de ML entrenado ===")
        print(f"Accuracy en test: {accuracy:.4f}")
        for f, imp in sorted(importancias.items(), key=lambda kv: -kv[1]):
            print(f"  {f:<14} {imp * 100:5.1f} %")
    return bundle


def load() -> dict:
    """Carga el modelo; si no existe model.joblib, lo entrena en el momento."""
    global _bundle
    if _bundle is None:
        _bundle = joblib.load(MODEL_FILE) if os.path.exists(MODEL_FILE) else train()
    return _bundle


def predict(temperatura: float, humedad: float, demora_horas: float, distancia_km: float) -> dict:
    model = load()["model"]
    X = np.array([[temperatura, humedad, demora_horas, distancia_km]])
    probs = dict(zip(model.classes_, model.predict_proba(X)[0]))
    nivel = str(max(probs, key=probs.get))
    return {
        "nivel": nivel,
        "probabilidad": round(float(probs[nivel]), 3),
        "probabilidades": {c: round(float(probs.get(c, 0.0)), 3) for c in CLASSES},
    }


def model_info() -> dict:
    b = load()
    return {
        "accuracy": round(b["accuracy"], 4),
        "importancias": b["importancias"],
        "muestras": b["muestras"],
        "n_estimators": N_ESTIMATORS,
        "max_depth": MAX_DEPTH,
    }


if __name__ == "__main__":
    # python ml_model.py  -> reentrena y muestra las métricas
    train()
