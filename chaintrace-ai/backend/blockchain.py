"""
blockchain.py — Blockchain permisionada propia de ChainTrace-AI.

Idea central: cada bloque guarda el hash del bloque anterior. Si alguien
modifica un bloque viejo, su hash deja de coincidir con su contenido y la
cadena "se rompe". Eso es lo que permite detectar cualquier manipulación.

Es una cadena única (un solo libro mayor) compartida por todos los productos;
el historial de un producto se obtiene filtrando por product_id.
"""

import hashlib
import json
import os
import time
from typing import List, Optional

# Prueba de trabajo liviana: el hash tiene que empezar con 3 ceros.
# Alcanza para mostrar el concepto de "minado" sin que la demo sea lenta.
DIFFICULTY = 3
PREFIX = "0" * DIFFICULTY

CHAIN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chain.json")


def calculate_hash(block: dict) -> str:
    """SHA-256 sobre un JSON canónico de todo el bloque, excepto el campo 'hash'.

    sort_keys=True garantiza que el mismo contenido produzca siempre el mismo
    texto (y por lo tanto el mismo hash), sin importar el orden de las claves.
    """
    contenido = {k: v for k, v in block.items() if k != "hash"}
    texto = json.dumps(contenido, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def mine(block: dict) -> dict:
    """Prueba de trabajo: incrementa el nonce hasta que el hash empiece con '000'."""
    block["nonce"] = 0
    block["hash"] = calculate_hash(block)
    while not block["hash"].startswith(PREFIX):
        block["nonce"] += 1
        block["hash"] = calculate_hash(block)
    return block


class Blockchain:
    def __init__(self, path: str = CHAIN_FILE):
        self.path = path
        self.chain: List[dict] = []
        self._load()

    # ---------- Persistencia ----------

    def _load(self) -> None:
        """Carga la cadena desde chain.json; si no existe, arranca con el génesis."""
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                self.chain = json.load(f)
        if not self.chain:
            self.chain = [self._create_genesis()]
            self._save()

    def _save(self) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.chain, f, ensure_ascii=False, indent=2)

    def reset(self) -> None:
        """Borra todo y deja sólo el bloque génesis."""
        self.chain = [self._create_genesis()]
        self._save()

    # ---------- Creación de bloques ----------

    def _create_genesis(self) -> dict:
        """Primer bloque de la cadena: no tiene anterior, por eso previous_hash = '0'."""
        genesis = {
            "index": 0,
            "timestamp": time.time(),
            "product_id": None,
            "actor": "Sistema",
            "event_type": "GENESIS",
            "data": {"mensaje": "Bloque génesis de ChainTrace-AI"},
            "prediction": None,
            "previous_hash": "0",
        }
        return mine(genesis)

    def add_block(
        self,
        product_id: str,
        actor: str,
        event_type: str,
        data: dict,
        prediction: Optional[dict] = None,
    ) -> dict:
        """Crea un bloque nuevo encadenado al último, lo mina y lo guarda."""
        block = {
            "index": len(self.chain),
            "timestamp": time.time(),
            "product_id": product_id,
            "actor": actor,
            "event_type": event_type,
            "data": data,
            "prediction": prediction,
            "previous_hash": self.chain[-1]["hash"],
        }
        mine(block)
        self.chain.append(block)
        self._save()
        return block

    # ---------- Consultas ----------

    def product_history(self, product_id: str) -> List[dict]:
        return [b for b in self.chain if b["product_id"] == product_id]

    def product_exists(self, product_id: str) -> bool:
        return any(
            b["product_id"] == product_id and b["event_type"] == "ALTA" for b in self.chain
        )

    # ---------- Validación ----------

    def is_valid(self) -> dict:
        """Recorre toda la cadena y verifica tres cosas en cada bloque:

        1. Que el hash recalculado coincida con el guardado (contenido intacto).
        2. Que el hash cumpla la prueba de trabajo (empieza con '000').
        3. Que previous_hash apunte al hash real del bloque anterior (enlace intacto).
        """
        for i, block in enumerate(self.chain):
            if calculate_hash(block) != block["hash"]:
                return {
                    "valido": False,
                    "motivo": f"El bloque #{i} fue alterado: su contenido ya no coincide con su hash",
                    "bloque": i,
                }
            if not block["hash"].startswith(PREFIX):
                return {
                    "valido": False,
                    "motivo": f"El bloque #{i} no cumple la prueba de trabajo",
                    "bloque": i,
                }
            if i > 0 and block["previous_hash"] != self.chain[i - 1]["hash"]:
                return {
                    "valido": False,
                    "motivo": f"El bloque #{i} no está enlazado correctamente con el bloque #{i - 1}",
                    "bloque": i,
                }
        return {"valido": True, "motivo": None, "bloque": None}

    # ---------- SOLO PARA LA DEMO ----------

    def tamper(self, index: int) -> dict:
        """Simula un ataque: modifica un bloque ya minado SIN recalcular su hash,
        como haría alguien con acceso directo a una base de datos común.

        Historia de la demo: alguien quiere ocultar que hubo una falla de frío,
        así que "baja" la temperatura a 4 °C y cambia el riesgo a "bajo".
        """
        if index < 0 or index >= len(self.chain):
            raise IndexError(f"No existe el bloque #{index}")
        block = self.chain[index]
        if "temperatura" in block["data"]:
            block["data"]["temperatura"] = 4.0
            if block["prediction"]:
                block["prediction"]["nivel"] = "bajo"
        elif block["event_type"] == "ALTA":
            block["data"]["origen"] = "Origen falsificado"
        else:
            block["data"]["manipulado"] = True
        self._save()
        return block
