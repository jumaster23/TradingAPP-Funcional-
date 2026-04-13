import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, '.env.local');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function isPlaceholder(value) {
  const v = String(value || '').trim().toLowerCase();
  return !v || v === 'tu_api_key_aqui' || v === 'your_api_key_here' || v === '...';
}

const envFileVars = parseEnvFile(ENV_FILE);
const merged = {
  ...envFileVars,
  ...process.env,
};

const errors = [];
const warnings = [];

const openrouterKey = merged.VITE_OPENROUTER_API_KEY;
if (isPlaceholder(openrouterKey)) {
  errors.push('Falta VITE_OPENROUTER_API_KEY (o es placeholder).');
}

const swFlag = String(merged.VITE_ENABLE_SW || '').trim();
if (!swFlag) {
  warnings.push('VITE_ENABLE_SW no definido. Recomendado: false para evitar cache stale al desplegar zip.');
} else if (swFlag !== 'false' && swFlag !== 'true') {
  warnings.push('VITE_ENABLE_SW debe ser true o false.');
}

if (errors.length) {
  console.error('\n[verify:deploy] Error de configuración de despliegue:\n');
  for (const e of errors) console.error(`- ${e}`);
  console.error('\nSolución rápida:');
  console.error('1) Copia .env.local.example a .env.local');
  console.error('2) Define VITE_OPENROUTER_API_KEY real');
  console.error('3) Deja VITE_ENABLE_SW=false para despliegue por zip\n');
  process.exit(1);
}

if (warnings.length) {
  console.warn('\n[verify:deploy] Advertencias:\n');
  for (const w of warnings) console.warn(`- ${w}`);
}

console.log('[verify:deploy] OK: configuración mínima válida para build/deploy.');
