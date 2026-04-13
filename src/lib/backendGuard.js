export function hasBase44Config() {
  return true;
}

export function getBase44ConfigError() {
  return 'Modo local activo: Base44 fue deshabilitado.';
}

function isPlaceholderValue(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === '...' || v === 'your_app_id' || v === 'tu_app_id';
}

export function isNotFoundError(err) {
  const msg = String(err?.message || '').toLowerCase();
  const is404 = err?.status === 404 || /\b404\b/.test(msg);
  if (!is404) return false;

  // Only classify as "missing backend resources" when it clearly refers
  // to local entities/functions/resources. Avoid catching external API 404s.
  return /base44|entidad|entity|funcion|function|resource|recurso|no implementada|not found/.test(msg);
}

export function isAuthError(err) {
  return err?.status === 401 || err?.status === 403;
}

export function getReadableError(err, fallback = 'Error inesperado') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  return fallback;
}
