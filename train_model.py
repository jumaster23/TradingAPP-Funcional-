import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score
from sklearn.model_selection import train_test_split

try:
    from xgboost import XGBClassifier
    HAS_XGBOOST = True
except Exception:
    HAS_XGBOOST = False


DATASET_PATH = Path("dataset.json")
MODEL_PATH = Path("model.pkl")
REPORT_PATH = Path("model_report.json")


def normalize_result(series: pd.Series) -> pd.Series:
    if series.dtype == bool:
        return series.astype(int)
    mapped = series.map({"win": 1, "loss": 0, "WIN": 1, "LOSS": 0})
    numeric = pd.to_numeric(series, errors="coerce")
    return mapped.fillna(numeric)


def clamp01(series: pd.Series) -> pd.Series:
    return series.clip(lower=0.0, upper=1.0)


def add_engineered_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    atr = pd.to_numeric(out.get("atr_15m", 0), errors="coerce").replace(0, np.nan)
    price = pd.to_numeric(out.get("current_price", out.get("entry_price", 0)), errors="coerce")
    val = pd.to_numeric(out.get("val", out.get("volume_val", np.nan)), errors="coerce")
    vah = pd.to_numeric(out.get("vah", out.get("volume_vah", np.nan)), errors="coerce")

    out["price_to_VAL"] = ((price - val) / atr).replace([np.inf, -np.inf], 0).fillna(0)
    out["price_to_VAH"] = ((price - vah) / atr).replace([np.inf, -np.inf], 0).fillna(0)

    sma20 = pd.to_numeric(out.get("sma20", out.get("ema20", np.nan)), errors="coerce")
    sma50 = pd.to_numeric(out.get("sma50", out.get("ema50", np.nan)), errors="coerce")
    out["trend_strength"] = (sma20 - sma50).fillna(0)

    high = pd.to_numeric(out.get("range_high", out.get("high", np.nan)), errors="coerce")
    low = pd.to_numeric(out.get("range_low", out.get("low", np.nan)), errors="coerce")
    denom = (high - low).replace(0, np.nan)
    out["range_position"] = clamp01(((price - low) / denom).replace([np.inf, -np.inf], np.nan).fillna(0.5))

    vol = pd.to_numeric(out.get("last_volume_15m", out.get("volume", np.nan)), errors="coerce")
    avg_vol = pd.to_numeric(out.get("avg_volume_15m", out.get("volume_avg", np.nan)), errors="coerce").replace(0, np.nan)
    out["relative_volume"] = (vol / avg_vol).replace([np.inf, -np.inf], np.nan).fillna(1.0)

    spx_trend = pd.to_numeric(out.get("spx_trend", 0), errors="coerce").fillna(0)
    nq_trend = pd.to_numeric(out.get("nq_trend", 0), errors="coerce").fillna(0)
    out["correlation_spx_nq"] = np.where(np.sign(spx_trend) == np.sign(nq_trend), 1, 0)

    gamma = pd.to_numeric(out.get("gamma_signal_alignment", 0), errors="coerce").fillna(0)
    vol_spike = pd.to_numeric(out.get("volume_spike", 0), errors="coerce").fillna(0)
    trend_align = np.where(np.sign(spx_trend) == np.sign(pd.to_numeric(out.get("signal_direction", 0), errors="coerce").fillna(0)), 1, 0)
    boll = pd.to_numeric(out.get("bollinger_position", 0.5), errors="coerce").fillna(0.5)
    boll_extreme = np.where((boll <= 0.15) | (boll >= 0.85), 1, 0)
    out["confluence_score"] = gamma + vol_spike + trend_align + boll_extreme

    return out


def profit_factor(profits: np.ndarray) -> float:
    gains = profits[profits > 0].sum()
    losses = -profits[profits < 0].sum()
    if losses == 0:
        return float("inf") if gains > 0 else 0.0
    return float(gains / losses)


def sharpe_ratio(profits: np.ndarray) -> float:
    if len(profits) < 2:
        return 0.0
    std = np.std(profits)
    if std == 0:
        return 0.0
    return float(np.mean(profits) / std * np.sqrt(252))


def max_drawdown(profits: np.ndarray) -> float:
    if len(profits) == 0:
        return 0.0
    equity = np.cumsum(profits)
    peaks = np.maximum.accumulate(equity)
    drawdowns = peaks - equity
    peak_cap = np.maximum(peaks, 1e-9)
    return float(np.max(drawdowns / peak_cap))


def evaluate_strategy(y_true: np.ndarray, y_prob: np.ndarray, profits: np.ndarray, threshold: float = 0.65) -> dict:
    preds = (y_prob >= threshold).astype(int)
    selected = preds == 1
    selected_profits = profits[selected]

    wr = float((selected_profits > 0).mean()) if selected.any() else 0.0
    pf = profit_factor(selected_profits) if selected.any() else 0.0
    sharpe = sharpe_ratio(selected_profits) if selected.any() else 0.0
    dd = max_drawdown(selected_profits) if selected.any() else 0.0

    return {
        "accuracy": float(accuracy_score(y_true, preds)),
        "precision": float(precision_score(y_true, preds, zero_division=0)),
        "selected_trades": int(selected.sum()),
        "selected_share": float(selected.mean()),
        "winrate": wr,
        "profit_factor": pf,
        "sharpe_ratio": sharpe,
        "max_drawdown": dd,
        "threshold": threshold,
    }


with DATASET_PATH.open("r", encoding="utf-8") as f:
    data = json.load(f)

df = pd.DataFrame(data)
if df.empty:
    raise ValueError("dataset.json esta vacio. Agrega trades historicos antes de entrenar.")
if "result" not in df.columns:
    raise ValueError("El dataset debe incluir la columna 'result' (0/1 o win/loss).")

df = df[df["result"].notnull()].copy()
df["result"] = normalize_result(df["result"])
df = df[df["result"].isin([0, 1])].copy()
if len(df) < 30:
    raise ValueError("Muy pocas muestras para entrenar. Recomendado: 30+ (ideal 500+).")

df["profit"] = pd.to_numeric(df.get("profit", 0), errors="coerce").fillna(0.0)
df = add_engineered_features(df)

drop_cols = [c for c in ["id", "timestamp", "result", "profit"] if c in df.columns]
X = df.drop(columns=drop_cols).apply(pd.to_numeric, errors="coerce").fillna(0.0)
y = df["result"].astype(int)
profits = df["profit"].astype(float)

X_train, X_test, y_train, y_test, p_train, p_test = train_test_split(
    X,
    y,
    profits,
    test_size=0.30,
    random_state=42,
    stratify=y if len(set(y)) > 1 else None,
)

model_rf = RandomForestClassifier(n_estimators=300, max_depth=10, random_state=42)
model_lr = LogisticRegression(max_iter=1200, class_weight="balanced", random_state=42)
if HAS_XGBOOST:
    model_xgb = XGBClassifier(
        n_estimators=250,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        random_state=42,
        eval_metric="logloss",
    )
    xgb_name = "xgboost"
else:
    model_xgb = GradientBoostingClassifier(random_state=42)
    xgb_name = "gradient_boosting_fallback"

model_rf.fit(X_train, y_train)
model_lr.fit(X_train, y_train)
model_xgb.fit(X_train, y_train)

prob_rf = model_rf.predict_proba(X_test)[:, 1]
prob_lr = model_lr.predict_proba(X_test)[:, 1]
prob_xgb = model_xgb.predict_proba(X_test)[:, 1]
prob_final = (prob_rf + prob_lr + prob_xgb) / 3.0

metrics_rf = evaluate_strategy(y_test.to_numpy(), prob_rf, p_test.to_numpy(), threshold=0.65)
metrics_lr = evaluate_strategy(y_test.to_numpy(), prob_lr, p_test.to_numpy(), threshold=0.65)
metrics_xgb = evaluate_strategy(y_test.to_numpy(), prob_xgb, p_test.to_numpy(), threshold=0.65)
metrics_ensemble = evaluate_strategy(y_test.to_numpy(), prob_final, p_test.to_numpy(), threshold=0.65)

artifact = {
    "models": {
        "random_forest": model_rf,
        "logistic_regression": model_lr,
        xgb_name: model_xgb,
    },
    "model_names": {
        "rf": "random_forest",
        "lr": "logistic_regression",
        "xgb": xgb_name,
    },
    "feature_columns": list(X.columns),
    "train_rows": int(len(X_train)),
    "test_rows": int(len(X_test)),
}

report = {
    "dataset": {
        "rows_total": int(len(df)),
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "feature_count": int(X.shape[1]),
    },
    "models": {
        "random_forest": metrics_rf,
        "logistic_regression": metrics_lr,
        xgb_name: metrics_xgb,
        "ensemble_average": metrics_ensemble,
    },
    "decision_policy": {
        "full_size_threshold": 0.75,
        "half_size_threshold": 0.65,
        "below_threshold_action": "NO_TRADE",
        "risk_per_trade_pct": 0.01,
        "stop_trading_drawdown_pct": 0.10,
    },
}

joblib.dump(artifact, MODEL_PATH)
REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")

print("Modelo ensemble entrenado ✅")
print(f"Muestras usadas: {len(df)}")
print(f"Features: {len(X.columns)}")
print(f"Modelo guardado en: {MODEL_PATH}")
print(f"Reporte guardado en: {REPORT_PATH}")
