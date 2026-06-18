"""
Backtest del algoritmo EXACT de Live2Panel.jsx
Estrategia: Extreme Range (SPY+QQQ en extremo de rango 20 barras + ticker en extremo + volumen 1.8x)
Risk/Reward: $1 riesgo, $3 ganancia minima
"""
import sys
import json
import math
import urllib.request
import ssl

# Bypass SSL verification for Yahoo Finance
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

def fetch_yahoo(ticker, interval='1m', range_='5d'):
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval={interval}&range={range_}'
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"ERROR fetching {ticker}: {e}")
        return None

def get_quote(data):
    if not data: return {}, [], [], [], []
    result = data.get('chart', {}).get('result', [{}])[0]
    q = result.get('indicators', {}).get('quote', [{}])[0]
    ts = result.get('timestamp', [])
    closes = [v for v in q.get('close', []) if v is not None]
    highs  = [v for v in q.get('high', [])  if v is not None]
    lows   = [v for v in q.get('low', [])   if v is not None]
    vols   = [v for v in q.get('volume', []) if v is not None]
    return ts, closes, highs, lows, vols

def calculate_atr(highs, lows, closes, period=14):
    if len(highs) < 2: return None
    trs = []
    for i in range(1, min(len(highs), len(lows), len(closes))):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    if not trs: return None
    return sum(trs[-period:]) / min(len(trs), period)

def get_trend(closes, n=5):
    if len(closes) < n: return 'NEUTRAL'
    return 'BULL' if closes[-1] > closes[-n] else 'BEAR'

def analyze_tick(i, ticker_c, ticker_h, ticker_l, ticker_v, spy_c, spy_h, spy_l, qqq_c, qqq_h, qqq_l):
    """Port exact de analyzeTicker() de Live2Panel.jsx"""
    if i < 20: return None

    price = ticker_c[i]
    RANGE_LB = 20

    # Market extremes (SPY + QQQ)
    spy_rh = max(spy_h[max(0,i-RANGE_LB):i]) if len(spy_h) > i else 0
    spy_rl = min(spy_l[max(0,i-RANGE_LB):i]) if len(spy_l) > i else 0
    qqq_rh = max(qqq_h[max(0,i-RANGE_LB):i]) if len(qqq_h) > i else 0
    qqq_rl = min(qqq_l[max(0,i-RANGE_LB):i]) if len(qqq_l) > i else 0

    spy_cur = spy_c[i] if i < len(spy_c) else 0
    qqq_cur = qqq_c[i] if i < len(qqq_c) else 0

    spy_at_high = spy_cur >= spy_rh * 0.998 if spy_rh else False
    spy_at_low  = spy_cur <= spy_rl * 1.002 if spy_rl else False
    qqq_at_high = qqq_cur >= qqq_rh * 0.998 if qqq_rh else False
    qqq_at_low  = qqq_cur <= qqq_rl * 1.002 if qqq_rl else False

    market_at_high = spy_at_high and qqq_at_high
    market_at_low  = spy_at_low  and qqq_at_low

    if not market_at_high and not market_at_low:
        return None

    # Ticker extreme
    tk_high = max(ticker_h[max(0,i-RANGE_LB):i])
    tk_low  = min(ticker_l[max(0,i-RANGE_LB):i])
    tk_at_high = price >= tk_high * 0.998
    tk_at_low  = price <= tk_low  * 1.002

    # Trend
    trend_1h = get_trend(ticker_c[max(0,i-60):i+1])
    major_trend_ok = (market_at_high and trend_1h != 'BEAR') or (market_at_low and trend_1h != 'BULL')

    if not major_trend_ok:
        return None

    # Volume
    avg_vol = sum(ticker_v[max(0,i-20):i]) / 20 if len(ticker_v) > i else 1
    vol_confirmed = ticker_v[i] > avg_vol * 1.8 if i < len(ticker_v) and avg_vol > 0 else False

    is_golden = market_at_high and tk_at_high and vol_confirmed and major_trend_ok

    # ATR
    atr = calculate_atr(ticker_h[max(0,i-15):i+1], ticker_l[max(0,i-15):i+1], ticker_c[max(0,i-15):i+1])

    RISK_CAP = 1.00
    RISK_RATIO = 3

    if market_at_high and tk_at_high and major_trend_ok:
        raw_target = 3.00 if is_golden else ((atr or 0.5) * 3.5)
        raw_risk = raw_target / RISK_RATIO
        if raw_risk > RISK_CAP: raw_risk = RISK_CAP
        risk = round(raw_risk, 2)
        target = round(risk * RISK_RATIO, 2)
        return {
            'signal': 'INSTITUTIONAL CALL' if is_golden else 'RANGE CALL',
            'sl': price - risk,
            'tp': price + target,
            'risk': risk,
            'target': target,
        }

    if market_at_low and tk_at_low and major_trend_ok:
        raw_target = 3.00 if is_golden else ((atr or 0.5) * 3.5)
        raw_risk = raw_target / RISK_RATIO
        if raw_risk > RISK_CAP: raw_risk = RISK_CAP
        risk = round(raw_risk, 2)
        target = round(risk * RISK_RATIO, 2)
        return {
            'signal': 'INSTITUTIONAL PUT' if is_golden else 'RANGE PUT',
            'sl': price + risk,
            'tp': price - target,
            'risk': risk,
            'target': target,
        }

    return None

def run_backtest(ticker='QQQ'):
    print(f"\n{'='*60}")
    print(f"BACKTEST — Estrategia Live2Panel.jsx EXACT — {ticker}")
    print(f"{'='*60}")

    print("Descargando datos...")
    spy_raw = fetch_yahoo('SPY', '1m', '5d')
    qqq_raw = fetch_yahoo('QQQ', '1m', '5d')
    tk_raw  = fetch_yahoo(ticker, '1m', '5d')

    if not spy_raw or not qqq_raw or not tk_raw:
        print("ERROR: No se pudieron descargar datos.")
        return

    _, spy_c, spy_h, spy_l, _ = get_quote(spy_raw)
    _, qqq_c, qqq_h, qqq_l, _ = get_quote(qqq_raw)
    ts, tk_c, tk_h, tk_l, tk_v = get_quote(tk_raw)

    n = min(len(spy_c), len(qqq_c), len(tk_c))
    print(f"Datos: {n} velas de 1m")
    if n < 50:
        print("Datos insuficientes.")
        return

    trades = []
    active = None
    LOOKAHEAD = 240

    for i in range(20, n - LOOKAHEAD):
        price = tk_c[i]

        if active:
            is_call = 'CALL' in active['signal']
            sl, tp = active['sl'], active['tp']
            result = None
            exit_price = tk_c[min(i + LOOKAHEAD, n - 1)]
            mov = 0

            for j in range(1, LOOKAHEAD + 1):
                if i + j >= n: break
                fh = tk_h[i + j]
                fl = tk_l[i + j]
                if is_call:
                    if fh >= tp:
                        result, exit_price = 'WIN', tp; break
                    if fl <= sl:
                        result, exit_price = 'LOSS', sl; break
                else:
                    if fl <= tp:
                        result, exit_price = 'WIN', tp; break
                    if fh >= sl:
                        result, exit_price = 'LOSS', sl; break

            if result is None:
                result = 'TIMEOUT'

            mov = (exit_price - active['entry']) if is_call else (active['entry'] - exit_price)
            trades.append({**active, 'exit': exit_price, 'mov': round(mov, 2), 'result': result})
            active = None
            continue

        sig = analyze_tick(i, tk_c, tk_h, tk_l, tk_v, spy_c, spy_h, spy_l, qqq_c, qqq_h, qqq_l)
        if sig:
            active = {**sig, 'entry': price, 'idx': i}

    # Results
    wins    = [t for t in trades if t['result'] == 'WIN']
    losses  = [t for t in trades if t['result'] == 'LOSS']
    timeouts = [t for t in trades if t['result'] == 'TIMEOUT']
    total   = len(trades)
    wr      = (len(wins) / total * 100) if total > 0 else 0

    print(f"\n{'='*60}")
    print(f"RESULTADOS:")
    print(f"  Total Trades : {total}")
    print(f"  Wins (WIN)   : {len(wins)}")
    print(f"  Losses (LOSS): {len(losses)}")
    print(f"  Timeouts     : {len(timeouts)}")
    print(f"  WIN RATE     : {wr:.1f}%")

    if total > 0:
        gross = sum(t['target'] for t in wins) - sum(t['risk'] for t in losses)
        print(f"  PnL bruto    : ${gross:.2f} (por 1 share)")
        print(f"\nDetalle por trade:")
        print(f"{'#':>3} {'Signal':<22} {'Entry':>8} {'SL':>8} {'TP':>8} {'Exit':>8} {'Mov$':>7} {'Result':<10}")
        print("-"*80)
        for j, t in enumerate(trades[:20]):
            print(f"{j+1:>3} {t['signal']:<22} {t['entry']:>8.2f} {t['sl']:>8.2f} {t['tp']:>8.2f} {t['exit']:>8.2f} {t['mov']:>+7.2f} {t['result']:<10}")

    return {'total': total, 'wins': len(wins), 'losses': len(losses), 'win_rate': wr}

if __name__ == '__main__':
    ticker = sys.argv[1] if len(sys.argv) > 1 else 'QQQ'
    run_backtest(ticker)
