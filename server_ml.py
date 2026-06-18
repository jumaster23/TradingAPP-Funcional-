from flask import Flask, request, jsonify
import tempfile
import os
import subprocess
import json

app = Flask(__name__)

@app.route('/api/train', methods=['POST'])
def train_model():
    data = request.get_json()
    if not data or 'data' not in data:
        return jsonify({'error': 'No data provided'}), 400
    # Guardar datos temporales
    with tempfile.NamedTemporaryFile(delete=False, suffix='.json', mode='w', encoding='utf-8') as tmp:
        json.dump(data['data'], tmp)
        tmp_path = tmp.name
    # Ejecutar script de entrenamiento
    out_dir = os.path.abspath('ml/artifacts')
    os.makedirs(out_dir, exist_ok=True)
    cmd = [
        'python', 'ml/train_ml_models.py',
        '--input', tmp_path,
        '--out-dir', out_dir
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        # Leer el reporte generado
        report_path = os.path.join(out_dir, 'training_report.json')
        if os.path.exists(report_path):
            with open(report_path, 'r', encoding='utf-8') as f:
                report = json.load(f)
            return jsonify({'message': 'Entrenamiento completado', 'report': report})
        else:
            return jsonify({'error': 'No se generó el reporte'}), 500
    except subprocess.CalledProcessError as e:
        return jsonify({'error': e.stderr}), 500
    finally:
        os.remove(tmp_path)

if __name__ == '__main__':
    app.run(port=5001, debug=True)
