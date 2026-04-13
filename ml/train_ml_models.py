#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


META_COLUMNS = {
    "analysis_id",
    "journal_entry_id",
    "ticker",
    "source_window",
    "signal",
    "setup_grade",
    "size_tier",
    "success_probability",
    "profit",
    "label",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Entrena modelos ML (Logistic Regression + Random Forest) sobre dataset exportado del bot."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Ruta a dataset exportado desde Journal (JSON o CSV).",
    )
    parser.add_argument(
        "--out-dir",
        default="ml/artifacts",
        help="Directorio de salida para modelos y reportes.",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.25,
        help="Porcentaje para test split. Ej: 0.25",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.70,
        help="Threshold sugerido de entrada para evaluar precision operativa.",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Semilla para reproducibilidad.",
    )
    return parser.parse_args()


def load_dataset(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Dataset no encontrado: {path}")

    if path.suffix.lower() == ".json":
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            raise ValueError("El JSON debe ser un array de registros.")
        return pd.DataFrame(data)

    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)

    raise ValueError("Formato no soportado. Usa JSON o CSV.")


def to_binary_label(series: pd.Series) -> pd.Series:
    if series.dtype == bool:
        return series.astype(int)
    return pd.to_numeric(series, errors="coerce")


def split_features(df: pd.DataFrame):
    if "label" not in df.columns:
        raise ValueError("El dataset no contiene columna 'label'. Exporta muestras etiquetadas desde Journal.")

    df = df.copy()
    df["label"] = to_binary_label(df["label"])
    df = df[df["label"].isin([0, 1])]

    if len(df) < 30:
        raise ValueError("Muy pocas muestras etiquetadas. Se recomienda al menos 30 para entrenar una primera version.")

    y = df["label"].astype(int)

    feature_cols = [c for c in df.columns if c not in META_COLUMNS]
    X = df[feature_cols].copy()

    numeric_cols = [c for c in X.columns if pd.api.types.is_numeric_dtype(X[c])]
    categorical_cols = [c for c in X.columns if c not in numeric_cols]

    return X, y, numeric_cols, categorical_cols, feature_cols


def build_preprocessor(numeric_cols, categorical_cols):
    numeric_pipe = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )

    categorical_pipe = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]
    )

    return ColumnTransformer(
        transformers=[
            ("num", numeric_pipe, numeric_cols),
            ("cat", categorical_pipe, categorical_cols),
        ]
    )


def evaluate_model(model, X_test, y_test):
    pred = model.predict(X_test)
    proba = model.predict_proba(X_test)[:, 1]

    return {
        "accuracy": float(accuracy_score(y_test, pred)),
        "precision": float(precision_score(y_test, pred, zero_division=0)),
        "recall": float(recall_score(y_test, pred, zero_division=0)),
        "f1": float(f1_score(y_test, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, proba)) if len(set(y_test)) > 1 else 0.0,
    }


def threshold_report(model, X_test, y_test, threshold: float):
    proba = model.predict_proba(X_test)[:, 1]
    selected = proba >= threshold

    total_selected = int(selected.sum())
    if total_selected == 0:
        return {
            "threshold": threshold,
            "selected_trades": 0,
            "selected_share": 0.0,
            "selected_winrate": None,
            "note": "Ningun trade supera el threshold; reduce el valor o espera mas datos.",
        }

    selected_y = y_test[selected]
    winrate = float((selected_y == 1).mean())
    return {
        "threshold": threshold,
        "selected_trades": total_selected,
        "selected_share": float(total_selected / len(y_test)),
        "selected_winrate": winrate,
        "note": "Winrate de trades filtrados por probabilidad del modelo.",
    }


def main():
    args = parse_args()
    in_path = Path(args.input)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    df = load_dataset(in_path)
    X, y, numeric_cols, categorical_cols, feature_cols = split_features(df)

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=args.test_size,
        random_state=args.random_state,
        stratify=y if len(set(y)) > 1 else None,
    )

    pre = build_preprocessor(numeric_cols, categorical_cols)

    logistic = Pipeline(
        steps=[
            ("preprocessor", pre),
            ("model", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=args.random_state)),
        ]
    )
    random_forest = Pipeline(
        steps=[
            ("preprocessor", pre),
            (
                "model",
                RandomForestClassifier(
                    n_estimators=300,
                    max_depth=10,
                    min_samples_leaf=4,
                    class_weight="balanced",
                    random_state=args.random_state,
                    n_jobs=-1,
                ),
            ),
        ]
    )

    logistic.fit(X_train, y_train)
    random_forest.fit(X_train, y_train)

    metrics_log = evaluate_model(logistic, X_test, y_test)
    metrics_rf = evaluate_model(random_forest, X_test, y_test)

    best_name = "random_forest" if metrics_rf["f1"] >= metrics_log["f1"] else "logistic_regression"
    best_model = random_forest if best_name == "random_forest" else logistic
    best_metrics = metrics_rf if best_name == "random_forest" else metrics_log

    report = {
        "dataset": {
            "input": str(in_path),
            "rows_total": int(len(df)),
            "rows_labeled": int(len(y)),
            "train_rows": int(len(X_train)),
            "test_rows": int(len(X_test)),
            "positive_rate": float(y.mean()),
        },
        "feature_space": {
            "feature_count": int(len(feature_cols)),
            "numeric_features": numeric_cols,
            "categorical_features": categorical_cols,
        },
        "models": {
            "logistic_regression": metrics_log,
            "random_forest": metrics_rf,
        },
        "selected_model": {
            "name": best_name,
            "metrics": best_metrics,
            "threshold_eval": threshold_report(best_model, X_test, y_test, args.threshold),
        },
        "recommendation": {
            "use_as_final_filter": True,
            "logic": f"execute = strategy_base and ml_prob >= {args.threshold}",
            "note": "No reemplaza estrategia. Solo filtra entradas de baja calidad.",
        },
    }

    joblib.dump(logistic, out_dir / "logistic_regression.joblib")
    joblib.dump(random_forest, out_dir / "random_forest.joblib")
    joblib.dump(best_model, out_dir / "best_model.joblib")

    with (out_dir / "training_report.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("Entrenamiento completado")
    print(f"Modelo seleccionado: {best_name}")
    print(f"Reporte: {out_dir / 'training_report.json'}")


if __name__ == "__main__":
    main()