# 📈 Trading Bot Híbrido

**Web app para análisis de trading en tiempo real** con IA, ML y journal de trades.

Combina datos de **Yahoo Finance, CBOE, Alpaca** + análisis con **OpenRouter AI** para evaluar setups intradía en timeframes 1m–1h.

---

## 🚀 Inicio Rápido

### Desarrollo

```bash
# Instalar
npm install

# Configurar (crear .env.local)
cp .env.example .env.local
# → Editar: VITE_OPENROUTER_API_KEY=tu_clave

# Ejecutar (hot-reload)
npm run dev
# → http://localhost:5173
```

### Producción

```bash
npm run build
npm start
# → http://localhost:4173
```

---

## 📦 Despliegue

**Para Render, Vercel, Docker, VPS → Ver [DEPLOY.md](DEPLOY.md)**

**Render 1-click (recomendado):**
1. Push a GitHub
2. Render.com → New Web Service → conectar repo
3. Build: `npm install && npm run build`
4. Start: `npm start`
5. Env: `VITE_OPENROUTER_API_KEY=tu_clave`
6. Deploy ✅


---

## 🔑 Variables de Entorno

```env
VITE_OPENROUTER_API_KEY=   # (requerida) https://openrouter.ai/keys
VITE_ENABLE_SW=false        # Service Worker (false en prod)
VITE_ALPACA_API_KEY=        # (opcional) https://alpaca.markets
VITE_ALPACA_SECRET_KEY=     # (opcional)
```

Ver `.env.example` para plantilla completa.

---

## 📊 Módulos Principales

| Módulo | Propósito |
|--------|-----------|
| **Live** | Scanner intradía de setups A/B en 11 tickers (Mag7 + índices) |
| **Day Trading** | Análisis intraday con volatilidad y patrones |
| **Swing** | Swing trading con análisis de gaps y leaps |
| **Probabilities** | ORB, gap analysis, VIX |
| **Journal** | Registro y cierre de trades |
| **BotSettings** | Configuración y sync de señales a ML |

---

## 🤖 Machine Learning

Entrenar modelo para filtrar setups:

```bash
npm run ml:train:simple
```

**Dataset:** Señales guardadas + resultados (TP_HIT/SL_HIT) → `dataset.json`

Predicción automática en Live scanner: **68% a 80% de confianza mínima**.

---

## 🔧 Scripts

```bash
npm run dev              # Desarrollo (hot-reload)
npm run build            # Build producción
npm start                # Servidor (post-build, puerto 4173)
npm run lint             # Linter ESLint
npm run typecheck        # TypeScript check
npm run ml:train:simple  # Entrenar modelo ML
```

---

## 💾 Datos

- **localStorage:** Journal, BotSettings, Analysis, TickerStats
- **dataset.json:** Muestras ML (generado en servidor)
- **model.pkl:** Modelo ML entrenado (generado by Python)

Sin base de datos externa.

---

## 📂 Estructura

```
src/
├── pages/          # Live, DayTrading, Swing, Journal, etc.
├── components/     # Módulos intradía, patrones, charts
├── api/            # Proxies y cliente base44
├── lib/            # ML dataset, utilidades
└── hooks/          # Hooks custom (useAlpacaStream, useAnalysis, etc.)

ml/                 # Scripts Python (training, prediction)
public/             # Assets, manifest, service worker
server.js           # Backend Node Express (proxies + SPA)
vite.config.js      # Configuración Vite + middlewares dev
```

---

## 🌐 Fuentes de Datos

| Dato | Fuente | Auth |
|------|--------|------|
| Precios / Intraday | Yahoo Finance | — |
| VIX | Yahoo Finance | — |
| Gamma / OI | CBOE | — |
| Barras históricas | Alpaca/Yahoo | Opcional |
| Noticias | Google News, Yahoo, MarketWatch | — |
| **IA/Análisis** | **OpenRouter** | **🔑 Requerida** |

---

## 🐛 Troubleshooting

| Problema | Solución |
|----------|----------|
| Build falla: "API key falta" | `cp .env.example .env.local` + editar |
| API 502 errors | Usar `npm start` (no solo HTML estático) |
| ML no entrena | `pip install -r ml/requirements.txt` |
| Hot-reload no funciona | Usar `npm run dev` (dev mode) |

---

## 📝 Despliegue Detallado

**→ Ver [DEPLOY.md](DEPLOY.md)** para:
- Render.com (recomendado)
- Vercel
- Docker
- VPS (DigitalOcean, Linode, AWS)
- Heroku (deprecated)

---

## 📞 Soporte

- Docs de despliegue: [DEPLOY.md](DEPLOY.md)
- Plantilla env: [.env.example](.env.example)
- Linter: `npm run lint`
- TypeScript: `npm run typecheck`
