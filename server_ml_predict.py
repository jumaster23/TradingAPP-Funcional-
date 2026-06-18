from flask import Flask, request, jsonify
import joblib
import pandas as pd
import tempfile
import os
import json

app = Flask(__name__)

MODEL_PATH = os.path.abspath('ml/artifacts/best_model.joblib')

@app.route('/api/predict', methods=['POST'])
def predict():
    data = request.get_json()
    if not data or 'data' not in data:
        return jsonify({'error': 'No data provided'}), 400
    # Cargar modelo
    if not os.path.exists(MODEL_PATH):
        return jsonify({'error': 'Modelo no entrenado'}), 400
    model = joblib.load(MODEL_PATH)
    # Convertir a DataFrame
    df = pd.DataFrame(data['data'])
    # Eliminar columnas meta si existen
    meta_cols = [
        "analysis_id", "journal_entry_id", "ticker", "source_window", "signal", "setup_grade", "size_tier", "success_probability", "profit", "label"
    ]
    for col in meta_cols:
        if col in df.columns:
            df = df.drop(columns=[col])
    # Predecir probabilidades
    try:
        proba = model.predict_proba(df)[:, 1]
        return jsonify({'probabilities': proba.tolist()})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(port=5001, debug=True)
