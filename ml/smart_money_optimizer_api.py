import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, GridSearchCV
from sklearn.metrics import accuracy_score, classification_report
from flask import Flask, request, jsonify
import json

app = Flask(__name__)

@app.route('/api/ml/optimize', methods=['POST'])
def optimize_smart_money():
    data = request.get_json()
    rows = data.get('trades', [])
    if not rows:
        return jsonify({'error': 'No data provided'}), 400

    df = pd.DataFrame(rows)
    # Preprocesamiento simple
    df = df.dropna(subset=['rr', 'volumen', 'atr', 'resultado'])
    df['win'] = df['resultado'].str.lower().eq('win').astype(int)
    features = ['rr', 'volumen', 'atr']
    X = df[features]
    y = df['win']

    # Grid search para hiperparámetros
    param_grid = {
        'n_estimators': [50, 100],
        'max_depth': [2, 4, 6]
    }
    rf = RandomForestClassifier(random_state=42)
    grid = GridSearchCV(rf, param_grid, cv=3)
    grid.fit(X, y)
    best_model = grid.best_estimator_
    y_pred = best_model.predict(X)
    acc = accuracy_score(y, y_pred)
    report = classification_report(y, y_pred, output_dict=True)
    importances = dict(zip(features, best_model.feature_importances_))

    # Sugerir umbrales óptimos (simple: percentil 50 de los ganadores)
    winners = df[df['win'] == 1]
    best_rr = float(winners['rr'].quantile(0.5)) if not winners.empty else 1.5
    best_vol = float(winners['volumen'].quantile(0.5)) if not winners.empty else 0
    best_atr = float(winners['atr'].quantile(0.5)) if not winners.empty else 0

    return jsonify({
        'accuracy': acc,
        'classification_report': report,
        'feature_importance': importances,
        'best_params': {
            'rr': best_rr,
            'volumen': best_vol,
            'atr': best_atr
        }
    })

if __name__ == '__main__':
    app.run(port=5002, debug=True)
