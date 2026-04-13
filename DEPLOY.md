# 📈 Trading Bot Híbrido

Bot de trading web que analiza en tiempo real usando datos de **Yahoo Finance, CBOE, Alpaca** y **análisis IA con OpenRouter**. Incluye módulos de **day trading, swing trading, probabilidades, noticias, journal de trades y entrenamiento ML**.

---

## 🚀 Quick Start (Desarrollo Local)

### Requisitos
- **Node.js 18+** (LTS recomendado: 20.x)
- **npm 9+**
- **Python 3.9+** (solo si usas entrenamiento ML)

### 1. Instalar y configurar

```bash
# Descargar dependencias
npm install

# Copiar plantilla de variables de entorno
cp .env.example .env.local

# IMPORTANTE: editar .env.local y poner tu API key de OpenRouter
# VITE_OPENROUTER_API_KEY=tu_clave_real_aqui
```

Obtén una API key gratis en 5 min: https://openrouter.ai/keys

### 2. Modo desarrollo

```bash
npm run dev
# → abre http://localhost:5173
```

Cambios en tiempo real, hot-reload de componentes.

### 3. Build para producción

```bash
npm run build
npm start
# → http://localhost:4173
```

---

## 📦 Despliegue Producción

### Opción 1: **Render.com** (Recomendado — gratis con tier gratuito)

**Ventajas:** SPA + Node backend sin configuración extra, HTTPS automático.

#### Pasos:

1. **Conectar repositorio GitHub**
   - Fork o push este proyecto a GitHub
   - En Render.com: `+ New Web Service`
   - Conectar tu rama `main`

2. **Configurar servicio**
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Node version:** 20

3. **Variables de entorno (en dashboard Render)**
   - `VITE_OPENROUTER_API_KEY` = tu clave
   - `NODE_ENV` = `production`
   - `VITE_ENABLE_SW` = `false`

4. **Deploy automático**
   - Un push a `main` dispara build automático
   - URL: `https://tu-app.onrender.com`

### Opción 2: **Vercel** (Solo frontend; proxies requieren workaround)

> ⚠️ **Limitación:** Vercel no soporta Node backend en plan gratuito. Solo funciona si despliegas sin `/api/*`.

**Alternativa:** Usa Vercel solo para servir el `dist/` y apunta las APIs a un backend separado (Render, Heroku, AWS).

### Opción 3: **Heroku** (Siendo deprecado pero funciona)

```bash
# Crear app Heroku
heroku create tu-trading-bot
heroku config:set VITE_OPENROUTER_API_KEY=tu_clave

# Deploy
git push heroku main
```

### Opción 4: **Docker + Cualquier servidor**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 4173
CMD ["npm", "start"]
```

```bash
docker build -t trading-bot .
docker run -p 4173:4173 -e VITE_OPENROUTER_API_KEY=tu_clave trading-bot
```

### Opción 5: **VPS (DigitalOcean, Linode, AWS EC2)**

```bash
# En tu servidor
cd /var/www/trading-bot
git clone repo .
npm install
npm run build

# Usar PM2 para mantener el proceso vivo
npm install -g pm2
pm2 start server.js --name "trading-bot"
pm2 startup
pm2 save

# Reverse proxy con Nginx
# Apunta puerto 4173 a dominio con HTTPS
```

---

## 🔑 Variables de Entorno

Copia `.env.example` a `.env.local` (dev) o `.env` (producción):

| Variable | Valor | Requerida | Notas |
|----------|-------|-----------|-------|
| `VITE_OPENROUTER_API_KEY` | tu_clave | ✅ | Obten gratis en openrouter.ai/keys |
| `VITE_ENABLE_SW` | `false` | ❌ | Service Worker (false recomendado) |
| `VITE_ALPACA_API_KEY` | opcional | ❌ | Para datos Alpaca (fallback Yahoo) |
| `VITE_ALPACA_SECRET_KEY` | opcional | ❌ | Secreto Alpaca |
| `VITE_OPENROUTER_FALLBACK_MODELS` | opcional | ❌ | Modelos fallback LLM |
| `VITE_SWING_USE_LLM_SCANNERS` | `false` | ❌ | Activar scanners LLM en Swing |
| `NODE_ENV` | `production` | ❌ | Render/Vercel lo define auto |
| `PORT` | `4173` | ❌ | Render/Vercel lo define auto |

---

## 📂 Estructura del Proyecto

```
trading-bot-hibrido/
├── src/
│   ├── pages/              # Rutas principales (Live, DayTrading, Swing, etc)
│   ├── components/         # UI y módulos de análisis
│   ├── hooks/              # React hooks personalizados
│   ├── api/                # Cliente API (proxies, base44)
│   ├── lib/                # ML dataset, utilidades
│   ├── App.jsx
│   └── main.jsx
├── ml/                     # Scripts Python para training
├── public/                 # Assets estáticos
├── dist/                   # Build de producción (generado)
├── server.js               # Servidor Node Express
├── vite.config.js          # Configuración Vite
├── package.json
└── .env.example            # Plantilla de variables
```

---

## 🔧 Scripts Disponibles

```bash
npm run dev              # Desarrollo (Vite + hot-reload)
npm run build            # Build producción (valida + vite build)
npm start                # Ejecutar server.js (POST-build)
npm run preview          # Preview del build (dev only)
npm run lint             # ESLint sin auto-fix
npm run lint:fix         # ESLint con auto-fix
npm run typecheck        # TypeScript check (jsconfig)

npm run ml:train:simple  # Entrenar modelo ML simple
npm run ml:predict:simple "features_json"  # Predicción single
npm run bot:demo         # Demo del bot en Node
```

---

## 📊 Fuentes de Datos

| Dato | Fuente | Auth | Ejemplos |
|------|--------|------|----------|
| Precios / Gráficos intraday | Yahoo Finance | —— | AAPL, SPY, GLD |
| VIX | Yahoo Finance | —— | ^VIX (índice de volatilidad) |
| Gamma / Open Interest | CBOE | —— | Volatilidad esperada |
| Barras históricas | Alpaca / Yahoo | Opcional | 1m, 5m, 15m, 1h |
| Noticias financieras | Google News, Yahoo, MarketWatch, Faireconomy | —— | Feeds RSS |
| Análisis IA | OpenRouter (OpenAI, Anthropic, Google) | 🔑 Requerida | Análisis predicciones |

---

## 🤖 Machine Learning

El bot puede entrenar un modelo para filtrar setups. Flujo:

1. **Guardar señales** en el módulo Live
2. **Cerrar trades** en Journal (marcar win/loss)
3. **Exportar dataset** con `npm run ml:train:simple`
4. **Entrenar** con `python train_model.py`
5. **Usar modelo** para filtrar nuevas señales

Ver archivo `ml/train_ml_models.py` y `predict.py` para detalles.

---

## 💾 Persistencia de Datos

- **Journal, BotSettings, Analysis, TickerStats** → `localStorage` del navegador
- **dataset.json, model.pkl** → carpeta raíz del servidor
- **No hay base de datos externa** (diseño simplificado)

Los datos se pierden si limpias localStorage del navegador.

---

## 🐛 Troubleshooting

### ❌ `VITE_OPENROUTER_API_KEY` falta en build

**Solución:**
```bash
cp .env.example .env.local
# Editar y poner clave real
npm run build
```

### ❌ APIs de mercado responden 502

**Causa:** Proxy `/api/yahoo`, `/api/cboe` no está corriendo.

**Solución:**
```bash
npm run build
npm start
# Llamadas ahora van a http://localhost:4173/api/...
```

### ❌ "dist/ is empty" en producción

**Solución:**
```bash
rm -rf dist node_modules
npm install
npm run build
npm start
```

### ❌ Python error en `/api/ml/train`

**Causa:** `train_model.py` no encuentra dependencias.

**Solución:**
```bash
pip install -r ml/requirements.txt
npm start
```

---

## 📝 Licencia

Proyecto de uso personal.

---

## 🤝 Contribuciones

Para bugs o mejoras, abre un issue o PR.

---

## 📞 Soporte

- **Docs:** Ver `README.md` y comments en `src/`
- **Config:** Revisar `.env.example`
- **Errores de build:** Ver `npm run lint` y `npm run typecheck`
