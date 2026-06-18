// Test every SL from $0.50 to $1.00 in $0.05 increments
// ICT v3 + Rejection Zones | 5min | 60 days | 7 tickers
const TICKERS = ['QQQ', 'SPY', 'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMD'];
const DOLLAR_PER_MOVE = 50;
const ZONE_TOLERANCE = 0.15;

async function fetchYahoo(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json(); const r = data?.chart?.result?.[0]; if (!r) return null;
  const q = r.indicators?.quote?.[0] || {};
  return { timestamps: r.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}

function getMinET(t) { const d = new Date(t * 1000); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.getHours() * 60 + et.getMinutes(); }
function getDateET(t) { const d = new Date(t * 1000); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.toISOString().slice(0, 10); }
function ema(a, p) { if (!a || a.length < p) return []; const k = 2/(p+1); const e = [a[0]]; for (let i = 1; i < a.length; i++) e.push(a[i] != null ? a[i]*k + e[i-1]*(1-k) : e[i-1]); return e; }
function vwapCalc(h, l, c, v) { const vw = []; let n = 0, d = 0; for (let i = 0; i < c.length; i++) { if (h[i] != null && l[i] != null && c[i] != null && v[i] != null) { n += ((h[i]+l[i]+c[i])/3)*v[i]; d += v[i]; } vw.push(d ? +(n/d).toFixed(4) : null); } return vw; }
function swingLevels(h, l, s, e) { const lv = []; for (let i = Math.max(s+1,2); i < e-1; i++) { if (h[i]>h[i-1]&&h[i]>h[i+1]) lv.push({type:'HIGH',price:h[i]}); if (l[i]<l[i-1]&&l[i]<l[i+1]) lv.push({type:'LOW',price:l[i]}); } return lv; }
function filterDay(data, dateStr, f, t) { const idx = []; for (let i = 0; i < data.timestamps.length; i++) { if (getDateET(data.timestamps[i]) !== dateStr) continue; const m = getMinET(data.timestamps[i]); if (m >= f && m < t) idx.push(i); } return idx; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function detectRejectionZones(h, l, o, c, s, e) {
  const rej = [];
  for (let i = s; i < e; i++) { if (!h[i]||!l[i]||!o[i]||!c[i]) continue; const b = Math.abs(c[i]-o[i]); const tr = h[i]-l[i]; if (tr<0.01) continue; const wd = Math.min(o[i],c[i])-l[i]; const wu = h[i]-Math.max(o[i],c[i]); if (wd>b*0.8&&wd>tr*0.4) rej.push({price:+l[i].toFixed(2),type:'DEMAND'}); if (wu>b*0.8&&wu>tr*0.4) rej.push({price:+h[i].toFixed(2),type:'SUPPLY'}); }
  const zones = []; const used = new Set();
  for (let i = 0; i < rej.length; i++) { if (used.has(i)) continue; const cl = [rej[i]]; used.add(i); for (let j = i+1; j < rej.length; j++) { if (!used.has(j) && rej[j].type===rej[i].type && Math.abs(rej[j].price-rej[i].price)<=ZONE_TOLERANCE) { cl.push(rej[j]); used.add(j); } } zones.push({price:+(cl.reduce((s,r)=>s+r.price,0)/cl.length).toFixed(2),type:cl[0].type,count:cl.length,confirmed:cl.length>=2,strength:cl.length>=3?'STRONG':'MODERATE'}); }
  return zones;
}
function slInZone(sl, zones, dir) { const type = dir==='CALL'?'DEMAND':'SUPPLY'; for (const z of zones) { if (z.type===type&&z.confirmed&&Math.abs(sl-z.price)<=0.25) return z; } return null; }

function backtestDay(dateStr, data5m, data1h, spyD, vixD, ticker, FIXED_SL) {
  const trades = [];
  if (!data5m) return trades;
  const idx1h = data1h ? filterDay(data1h, dateStr, 570, 960) : [];
  let bias1h = 'NEUTRAL';
  if (idx1h.length >= 2) {
    const cc = idx1h.map(i=>data1h.closes[i]), hh = idx1h.map(i=>data1h.highs[i]), ll = idx1h.map(i=>data1h.lows[i]), vv = idx1h.map(i=>data1h.volumes[i]);
    const vw = vwapCalc(hh,ll,cc,vv), e3 = ema(cc,3), len = cc.length;
    if (cc[len-1]>vw[len-1]&&cc[len-1]>e3[len-1]) bias1h='BULLISH';
    else if (cc[len-1]<vw[len-1]&&cc[len-1]<e3[len-1]) bias1h='BEARISH';
  }
  if (bias1h==='NEUTRAL') return trades;

  const idx5 = filterDay(data5m, dateStr, 570, 960);
  if (idx5.length < 20) return trades;
  const h = idx5.map(i=>data5m.highs[i]), l = idx5.map(i=>data5m.lows[i]);
  const c = idx5.map(i=>data5m.closes[i]), o = idx5.map(i=>data5m.opens[i]);
  const v = idx5.map(i=>data5m.volumes[i]);
  const vw = vwapCalc(h,l,c,v), e9 = ema(c,9), e21 = ema(c,21), len = c.length;
  const confIdx = Math.min(12, len-1);
  const trendAligned = bias1h==='BULLISH'?(e9[confIdx]>e21[confIdx]&&c[confIdx]>vw[confIdx]):(e9[confIdx]<e21[confIdx]&&c[confIdx]<vw[confIdx]);
  const levels15 = swingLevels(h,l,0,Math.min(confIdx+5,len));
  let inTrade = false;

  for (let j = Math.max(8,confIdx+1); j < len-3; j++) {
    if (inTrade) continue;
    const candleMin = getMinET(data5m.timestamps[idx5[j]]);
    if (!((candleMin>=575&&candleMin<=660)||(candleMin>=840&&candleMin<=930))) continue;
    const price = c[j]; if (!price) continue;
    const vwapNow = vw[j];
    if (bias1h==='BULLISH'?price<=vwapNow:price>=vwapNow) continue;

    const zones = detectRejectionZones(h,l,o,c,Math.max(0,j-40),j).filter(z=>z.confirmed);
    const levels5 = swingLevels(h,l,Math.max(0,j-20),j);
    const allLevels = [...levels5,...levels15];

    let sweep = null;
    for (let k = Math.max(j-3,0); k <= j; k++) {
      if (!c[k]||!o[k]||!h[k]||!l[k]) continue;
      const body = Math.abs(c[k]-o[k]), wd = Math.min(c[k],o[k])-l[k], wu = h[k]-Math.max(c[k],o[k]);
      for (const lv of allLevels) {
        if (lv.type==='LOW'&&l[k]<lv.price&&c[k]>lv.price&&wd>body*0.5) sweep={type:'BULL',candleIdx:k};
        if (lv.type==='HIGH'&&h[k]>lv.price&&c[k]<lv.price&&wu>body*0.5) sweep={type:'BEAR',candleIdx:k};
      }
    }
    if (sweep&&bias1h==='BULLISH'&&sweep.type!=='BULL') continue;
    if (sweep&&bias1h==='BEARISH'&&sweep.type!=='BEAR') continue;

    let mss = false;
    if (sweep) {
      const si = sweep.candleIdx;
      if (sweep.type==='BULL') { let rh=-Infinity; for (let k=Math.max(0,si-10);k<si;k++){if(h[k]>rh)rh=h[k];} for (let k=si+1;k<=Math.min(j,si+12);k++){if(h[k]>rh){mss=true;break;}} }
      else { let rl=Infinity; for (let k=Math.max(0,si-10);k<si;k++){if(l[k]<rl)rl=l[k];} for (let k=si+1;k<=Math.min(j,si+12);k++){if(l[k]<rl){mss=true;break;}} }
    }

    let fvg=false,displacement=false,vwapReclaim=false;
    for (let k=Math.max(2,j-4);k<=j;k++){if(h[k]&&l[k]&&h[k-2]&&l[k-2]){if(l[k]>h[k-2]&&(l[k]-h[k-2])>0.03)fvg=true;if(h[k]<l[k-2]&&(l[k-2]-h[k])>0.03)fvg=true;}}
    const avgBody=c.slice(Math.max(0,j-10),j).reduce((s,c2,i2)=>s+Math.abs((c2||0)-(o[Math.max(0,j-10)+i2]||0)),0)/10;
    for (let k=Math.max(1,j-2);k<=j;k++){if(o[k]&&c[k]&&Math.abs(c[k]-o[k])>avgBody*1.5)displacement=true;}
    if(j>=4&&vw[j-3]&&vw[j]){if(c[j-3]<vw[j-3]&&c[j-2]<vw[j-2]&&c[j]>vw[j]&&bias1h==='BULLISH')vwapReclaim=true;if(c[j-3]>vw[j-3]&&c[j-2]>vw[j-2]&&c[j]<vw[j]&&bias1h==='BEARISH')vwapReclaim=true;}

    let setupType='NONE';
    if(sweep&&mss&&(fvg||displacement))setupType='SWEEP_MSS_FVG';
    else if(sweep&&mss)setupType='SWEEP_MSS';
    else if(vwapReclaim&&displacement)setupType='VWAP_RECLAIM';
    else if(sweep&&displacement)setupType='SWEEP_DISP';
    if(setupType==='NONE')continue;

    const targetTs=data5m.timestamps[idx5[j]];
    let spyOk=false,vixOk=false;
    if(spyD){let si=-1;for(let i=spyD.timestamps.length-1;i>=0;i--){if(spyD.timestamps[i]<=targetTs){si=i;break;}}if(si>=3&&spyD.closes[si]!=null&&spyD.closes[si-3]!=null){const chg=spyD.closes[si]-spyD.closes[si-3];spyOk=bias1h==='BULLISH'?chg>0:chg<0;}}
    if(vixD){let vi=-1;for(let i=vixD.timestamps.length-1;i>=0;i--){if(vixD.timestamps[i]<=targetTs){vi=i;break;}}if(vi>=3&&vixD.closes[vi]!=null&&vixD.closes[vi-3]!=null){const chg=vixD.closes[vi]-vixD.closes[vi-3];vixOk=bias1h==='BULLISH'?chg<0:chg>0;}}

    const avgVol=v.slice(Math.max(0,j-20),j).filter(x=>x>0).reduce((a,b)=>a+b,0)/20;
    const rvol=avgVol?+((v[j]||0)/avgVol).toFixed(2):0;
    const dir=bias1h==='BULLISH'?'CALL':'PUT';

    let score=1;
    if(trendAligned)score+=1;if(sweep)score+=2;if(mss)score+=2;if(price>vwapNow||price<vwapNow)score+=1;
    if(fvg)score+=1;if(displacement)score+=1;if(vwapReclaim)score+=1;if(spyOk)score+=1;if(vixOk)score+=1;if(rvol>=1.5)score+=1;
    const nearType=dir==='CALL'?'DEMAND':'SUPPLY';
    const near=zones.find(z=>z.type===nearType&&Math.abs(price-z.price)<=0.50);
    if(near)score+=near.strength==='STRONG'?2:1;
    if(score<5)continue;

    let sl=dir==='CALL'?+(price-FIXED_SL).toFixed(2):+(price+FIXED_SL).toFixed(2);
    const slZ=slInZone(sl,zones,dir);
    if(slZ){sl=dir==='CALL'?+(slZ.price-0.15).toFixed(2):+(slZ.price+0.15).toFixed(2);}
    const slDist=Math.abs(price-sl);
    if(slDist>2.00)continue;

    const entry=+price.toFixed(2);
    // Test TP 1:3
    const tp=dir==='CALL'?+(entry+slDist*3).toFixed(2):+(entry-slDist*3).toFixed(2);
    let exitPrice=null,resultado='CIERRE';
    for(let f=j+1;f<len;f++){
      if(dir==='CALL'){if(l[f]<=sl){exitPrice=sl;resultado='STOP';break;}if(h[f]>=tp){exitPrice=tp;resultado='TARGET';break;}}
      else{if(h[f]>=sl){exitPrice=sl;resultado='STOP';break;}if(l[f]<=tp){exitPrice=tp;resultado='TARGET';break;}}
    }
    if(!exitPrice){exitPrice=c[len-1]||entry;}
    const pnl=dir==='CALL'?+(exitPrice-entry).toFixed(2):+(entry-exitPrice).toFixed(2);
    trades.push({pnl,pnlC:+(pnl*DOLLAR_PER_MOVE).toFixed(0),resultado,slDist:+slDist.toFixed(2)});
    inTrade=true;
  }
  return trades;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SL RANGE TEST: $0.50 → $1.00 (cada $0.05)');
  console.log('  ICT v3 + Rejection Zones | 5min | 60d | TP 1:3');
  console.log('  Tickers: ' + TICKERS.join(', '));
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Fetching data...\n');
  const data5m={},data1h={};
  for(const t of TICKERS){
    process.stdout.write('  '+t+'...');
    data5m[t]=await fetchYahoo(t,'5m','60d');await sleep(400);
    data1h[t]=await fetchYahoo(t,'1h','60d');await sleep(400);
    console.log(data5m[t]?' ✅':' ⚠️');
  }
  const spyD=data5m['SPY']||await fetchYahoo('SPY','5m','60d');await sleep(500);
  const vixD=await fetchYahoo('^VIX','5m','60d');

  const allTs=[];
  for(const t of TICKERS){if(data5m[t])allTs.push(...data5m[t].timestamps);}
  const dates=[...new Set(allTs.map(t=>getDateET(t)))].sort();
  console.log('\nDias: '+dates.length+'\n');

  // Test each SL
  const slValues = [];
  for (let sl = 0.50; sl <= 1.01; sl += 0.05) slValues.push(+sl.toFixed(2));

  const results = [];

  for (const SL of slValues) {
    const allTrades = [];
    for (const d of dates) {
      for (const ticker of TICKERS) {
        const dt = backtestDay(d, data5m[ticker], data1h[ticker], spyD, vixD, ticker, SL);
        allTrades.push(...dt);
      }
    }
    const wins = allTrades.filter(t => t.pnl > 0);
    const losses = allTrades.filter(t => t.pnl < 0);
    const totalC = allTrades.reduce((s, t) => s + t.pnlC, 0);
    const wr = allTrades.length ? (wins.length / allTrades.length * 100).toFixed(0) : 0;
    const avgW = wins.length ? Math.round(wins.reduce((s,t) => s+t.pnlC, 0) / wins.length) : 0;
    const avgL = losses.length ? Math.round(losses.reduce((s,t) => s+t.pnlC, 0) / losses.length) : 0;
    const pf = losses.length && losses.reduce((s,t) => s+t.pnlC, 0) !== 0 ? Math.abs(wins.reduce((s,t)=>s+t.pnlC,0) / losses.reduce((s,t)=>s+t.pnlC,0)).toFixed(2) : '∞';

    // Max drawdown
    let peak=0,maxDD=0,run=0;
    for(const t of allTrades){run+=t.pnlC;if(run>peak)peak=run;if(peak-run>maxDD)maxDD=peak-run;}

    // Risk per trade
    const riskPerTrade = +(SL * DOLLAR_PER_MOVE).toFixed(0);

    results.push({ sl: SL, total: allTrades.length, wins: wins.length, losses: losses.length, wr, totalC, avgW, avgL, pf, maxDD, riskPerTrade });
  }

  // Print comparison
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  RESULTADOS');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(`${'SL'.padEnd(7)} ${'Risk$'.padEnd(7)} ${'Trades'.padEnd(8)} ${'WR'.padEnd(6)} ${'W'.padEnd(5)} ${'L'.padEnd(5)} ${'PnL'.padEnd(10)} ${'AvgW'.padEnd(8)} ${'AvgL'.padEnd(8)} ${'PF'.padEnd(6)} ${'MaxDD'.padEnd(8)} ${'$/dia'.padEnd(8)} Cuenta`);
  console.log('─'.repeat(105));

  let bestPnl = -Infinity, bestSL = 0;
  let bestWR_sl = 0, bestWR = 0;
  let bestPF_sl = 0, bestPF = 0;

  for (const r of results) {
    const pnlStr = (r.totalC >= 0 ? '+$' : '-$') + Math.abs(r.totalC);
    const perDay = Math.round(r.totalC / dates.length);
    const star = [];
    if (r.totalC > bestPnl) { bestPnl = r.totalC; bestSL = r.sl; }
    if (parseFloat(r.wr) > bestWR) { bestWR = parseFloat(r.wr); bestWR_sl = r.sl; }
    if (parseFloat(r.pf) > bestPF) { bestPF = parseFloat(r.pf); bestPF_sl = r.sl; }

    console.log(`$${r.sl.toFixed(2).padEnd(5)} $${r.riskPerTrade.toString().padEnd(6)} ${String(r.total).padEnd(8)} ${(r.wr+'%').padEnd(6)} ${String(r.wins).padEnd(5)} ${String(r.losses).padEnd(5)} ${pnlStr.padEnd(10)} +$${r.avgW.toString().padEnd(6)} $${r.avgL.toString().padEnd(7)} ${r.pf.padEnd(6)} $${r.maxDD.toString().padEnd(7)} +$${perDay.toString().padEnd(7)} $${(2000+r.totalC).toLocaleString()}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  GANADORES');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Mejor WR:    SL $${bestWR_sl.toFixed(2)} → ${bestWR}% WR`);
  console.log(`  Mejor PnL:   SL $${bestSL.toFixed(2)} → +$${bestPnl}`);
  console.log(`  Mejor PF:    SL $${bestPF_sl.toFixed(2)} → PF ${bestPF}`);
  console.log('');
}

main().catch(e => console.error('Error:', e.message));
