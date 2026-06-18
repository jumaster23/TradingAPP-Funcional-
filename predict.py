import sys
import json
from pathlib import Path

import joblib
import pandas as pd

MODEL_PATH = Path("model.pkl")

if not MODEL_PATH.exists():
    raise FileNotFoundError("No existe model.pkl. Ejecuta primero: python train_model.py")

# Cargar modelo
artifact = joblib.load(MODEL_PATH)
models = artifact.get("models", {})
if not models:
    legacy_model = artifact.get("model")
    if legacy_model is None:
        raise ValueError("Artifact invalido: no contiene modelos")
    models = {"legacy": legacy_model}
feature_columns = artifact.get("feature_columns", [])

if len(sys.argv) < 2:
    raise ValueError("Debes enviar el JSON de features como argumento.")

# Recibir datos desde Node
input_data = json.loads(sys.argv[1])

df = pd.DataFrame([input_data])

# Alinear columnas al entrenamiento
for col in feature_columns:
    if col not in df.columns:
        df[col] = 0.0

df = df[feature_columns]
df = df.apply(pd.to_numeric, errors="coerce").fillna(0.0)

probs = {}
for name, model in models.items():
    probs[name] = float(model.predict_proba(df)[0][1])

prob_final = float(sum(probs.values()) / max(1, len(probs)))

if len(sys.argv) > 2 and sys.argv[2] == "--json":
    print(json.dumps({"prob_final": prob_final, "models": probs}))
else:
    print(prob_final)
