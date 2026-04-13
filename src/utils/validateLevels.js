/**
 * Validate & fix entry/SL/TP relative to a real current_price.
 *
 * @param {object} item  - must contain current_price, signal, entry_price, stop_loss, take_profit
 * @param {object} opts
 *   maxEntryPct  – max acceptable distance from current_price for entry (default 0.08 = 8%)
 *   maxSlPct     – max SL distance from entry (default 0.10 = 10%)
 *   minRR        – minimum risk:reward ratio for TP (default 2 = 1:2)
 * @returns {object} item with corrected entry_price, stop_loss, take_profit
 */
export function validateLevels(item, { maxEntryPct = 0.08, maxSlPct = 0.10, minRR = 2 } = {}) {
  const price = item.current_price;
  if (!price || price <= 0) return item;

  const dir = (item.signal || '').toUpperCase();
  let { entry_price, stop_loss, take_profit } = item;

  // 1. Validate entry: must be within maxEntryPct of current price
  if (!entry_price || entry_price <= 0 || Math.abs(entry_price - price) / price > maxEntryPct) {
    const offset = price * 0.015; // 1.5% from current price
    entry_price = dir === 'PUT' ? +(price + offset).toFixed(2) : +(price - offset).toFixed(2);
  }

  // 2. Validate SL: must be on correct side and within maxSlPct of entry
  const slOk = dir === 'PUT'
    ? (stop_loss > entry_price && (stop_loss - entry_price) / entry_price <= maxSlPct)
    : (stop_loss < entry_price && (entry_price - stop_loss) / entry_price <= maxSlPct);

  if (!stop_loss || stop_loss <= 0 || !slOk) {
    const slDist = price * 0.05; // 5% default SL distance
    stop_loss = dir === 'PUT' ? +(entry_price + slDist).toFixed(2) : +(entry_price - slDist).toFixed(2);
  }

  // 3. Validate TP: must be on correct side and meet min R:R
  const risk = Math.abs(entry_price - stop_loss);
  const minTpDist = risk * minRR;

  const tpOk = dir === 'PUT'
    ? (take_profit < entry_price && (entry_price - take_profit) >= minTpDist * 0.8)
    : (take_profit > entry_price && (take_profit - entry_price) >= minTpDist * 0.8);

  if (!take_profit || take_profit <= 0 || !tpOk) {
    take_profit = dir === 'PUT'
      ? +(entry_price - minTpDist).toFixed(2)
      : +(entry_price + minTpDist).toFixed(2);
  }

  return { ...item, entry_price, stop_loss, take_profit };
}
