// COMBO: Level trigger + EMA/VWAP quality + SPY+VIX convergence + 1/ticker/day
// Best of /live + /live2

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker, interval, range, p1 = null, p2 = null) {
  let url;
  if (p1 && p2) url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&period1=${p1}&period2=${p2}&includePrePost=true`;
  else url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  return { timestamps: result.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}

async function fetch1minMonth(ticker) {
  const now = Math.floor(Date.now() / 1000);
  const chunks = [];
  for (let i = 0; i < 4; i++) {
    const end = now - i * 7 * 86400, start = end - 7 * 86400;
    const data = await fetchChart(ticker, '1m', null, start, end);
    if (data && data.timestamps.length > 0) chunks.unshift(data);
    await new Promise(r => setTimeout(r, 300));
  }
  if (!chunks.length) return null;
  const m = { timestamps: [], closes: [] };
  const seen = new Set();
  for (const c of chunks) for (let i = 0; i < c.timestamps.length; i++) {
    if (!seen.has(c.timestamps[i])) { seen.add(c.timestamps[i]); m.timestamps.push(c.timestamps[i]); m.closes.push(c.closes[i]); }
  }
  return m;
}

function getStop(p) { return p < 100 ? 0.5 : p < 250 ? 1 : p < 400 ? 1.5 : p < 550 ? 2 : 2.5; }

function calcEMA(arr, period) {
  const k = 2/(period+1); const ema = [arr[0]];
  for (let i = 1; i < arr.length; i++) ema.push(arr[i] != null ? arr[i]*k + ema[i-1]*(1-k) : ema[i-1]);
  return ema;
}

function getMinutesET(ts) {
  const d = new Date(ts*1000), et = new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));
  return et.getHours()*60+et.getMinutes();
}
function getDayKeyET(ts) {
  const d = new Date(ts*1000), et = new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));
  return `${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;
}
function groupByDay(ts) { const d = {}; for (let i = 0; i < ts.length; i++) { const k = getDayKeyET(ts[i]); if (!d[k]) d[k] = []; d[k].push(i); } return d; }

function simulateTrade(dir, entry, sd, data, si, ei) {
  const tgt = dir==='CALL' ? entry+sd*3 : entry-sd*3;
  let stop = dir==='CALL' ? entry-sd : entry+sd, be = false;
  for (let j = si+1; j <= ei; j++) {
    const h = data.highs[j], l = data.lows[j];
    if (h==null||l==null) continue;
    if (dir==='CALL') {
      if (h >= entry+sd && !be) { stop=entry; be=true; }
      if (l <= stop) return { pnl: stop-entry, type: be?'BE':'STOP' };
      if (h >= tgt) return { pnl: tgt-entry, type: 'TARGET' };
    } else {
      if (entry-l >= sd && !be) { stop=entry; be=true; }
      if (h >= stop) return { pnl: entry-stop, type: be?'BE':'STOP' };
      if (l <= tgt) return { pnl: entry-tgt, type: 'TARGET' };
    }
  }
  const ep = data.closes[ei]||entry;
  return { pnl: dir==='CALL'?ep-entry:entry-ep, type:'EOD' };
}

function mergeLevels(levels) {
  const pri = {PDH:3,PDL:3,PMH:2,PML:2,MH:1,ML:1};
  const sorted = [...levels].sort((a,b)=>a.price-b.price);
  const merged=[], used=new Set();
  for (let i=0;i<sorted.length;i++) {
    if(used.has(i)) continue; let best=sorted[i];
    for(let j=i+1;j<sorted.length;j++) {
      if(used.has(j)) continue;
      if(Math.abs(sorted[j].price-best.price)/best.price<0.005) {
        if((pri[sorted[j].name]||0)>(pri[best.name]||0)){used.add(i);best=sorted[j];}
        used.add(j);
      }
    }
    merged.push(best);
  }
  return merged;
}

function checkIdx(data, ts, dir, inverse) {
  let idx=-1;
  for(let i=data.timestamps.length-1;i>=0;i--){if(data.timestamps[i]<=ts){idx=i;break;}}
  if(idx<3) return false;
  const c=data.closes;
  if(c[idx]==null||c[idx-1]==null||c[idx-3]==null) return false;
  const p=c[idx],t3=p-c[idx-3],t1=p-c[idx-1],th=p*0.00003;
  if(inverse) return dir==='CALL'?(t3<-th&&t1<=0):(t3>th&&t1>=0);
  return dir==='CALL'?(t3>th&&t1>=0):(t3<-th&&t1<=0);
}

async function run() {
  console.log('Fetching SPY+VIX 1min (4 weeks)...');
  const [spy1m, vix1m] = await Promise.all([fetch1minMonth('SPY'), fetch1minMonth('^VIX')]);
  console.log(`SPY:${spy1m?.timestamps.length||0} VIX:${vix1m?.timestamps.length||0}`);

  // Test multiple variants
  const strategies = {
    'COMBO (level+ema+vwap+spyvix+1/tkr)': [],
    'COMBO sin VWAP': [],
    'COMBO sin EMA': [],
    'Ultra Simple SPY+VIX (baseline)': [],
  };

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);
    const [data5m, dailyData] = await Promise.all([
      fetchChart(ticker, '5m', '1mo'),
      fetchChart(ticker, '1d', '3mo'),
    ]);
    if (!data5m || data5m.timestamps.length < 50) { console.log('skip'); continue; }

    const days = groupByDay(data5m.timestamps);
    const dayKeys = Object.keys(days).sort();
    const dCloses = dailyData ? dailyData.closes.filter(v=>v!=null) : [];
    const dTs = dailyData ? dailyData.timestamps : [];
    const dEma10 = calcEMA(dCloses, 10);

    // 5min indicators for full series
    const ema10 = calcEMA(data5m.closes, 10);
    const ema20 = calcEMA(data5m.closes, 20);

    function getDayTrend(dk) {
      if(dCloses.length<12) return 'NEUTRAL';
      const ts=new Date(dk+'T12:00:00').getTime()/1000;
      let idx=-1;
      for(let i=dTs.length-1;i>=0;i--){if(dTs[i]<=ts+86400){idx=i;break;}}
      if(idx<10||!dEma10[idx]) return 'NEUTRAL';
      if(dCloses[idx]>dEma10[idx]&&dCloses[idx-1]>dCloses[idx-2]) return 'UP';
      if(dCloses[idx]<dEma10[idx]&&dCloses[idx-1]<dCloses[idx-2]) return 'DOWN';
      return 'NEUTRAL';
    }

    let tc = 0;
    for (let di=1; di<dayKeys.length; di++) {
      const dk=dayKeys[di], pdk=dayKeys[di-1];
      const indices=days[dk], prevIndices=days[pdk];
      if(!prevIndices||indices.length<15) continue;

      // Levels
      let rawLevels = [];
      let pdh=-Infinity, pdl=Infinity;
      for(const pi of prevIndices) {
        const m=getMinutesET(data5m.timestamps[pi]);
        if(m>=570&&m<960) {
          if(data5m.highs[pi]!=null&&data5m.highs[pi]>pdh) pdh=data5m.highs[pi];
          if(data5m.lows[pi]!=null&&data5m.lows[pi]<pdl) pdl=data5m.lows[pi];
        }
      }
      if(pdh!==-Infinity){rawLevels.push({name:'PDH',price:+pdh.toFixed(2)});rawLevels.push({name:'PDL',price:+pdl.toFixed(2)});}

      let pmh=-Infinity,pml=Infinity,pmc=0;
      for(const ci of indices){
        const m=getMinutesET(data5m.timestamps[ci]);
        if(m>=240&&m<570){
          if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];
          if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];
          pmc++;
        }
      }
      if(pmc>=3&&pmh!==-Infinity){rawLevels.push({name:'PMH',price:+pmh.toFixed(2)});rawLevels.push({name:'PML',price:+pml.toFixed(2)});}

      const levels = mergeLevels(rawLevels);
      if(!levels.length) continue;
      const dt = getDayTrend(dk);

      // VWAP for today
      let vNum=0,vDen=0; const dayStart=indices[0];
      const dayVwaps = [];
      for(const ci of indices) {
        if(data5m.highs[ci]!=null&&data5m.lows[ci]!=null&&data5m.closes[ci]!=null&&data5m.volumes[ci]!=null) {
          vNum+=((data5m.highs[ci]+data5m.lows[ci]+data5m.closes[ci])/3)*data5m.volumes[ci];
          vDen+=data5m.volumes[ci];
        }
        dayVwaps.push(vDen?vNum/vDen:null);
      }

      const regIdx = indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<955;});

      // Per-strategy state
      const state = {};
      for(const k of Object.keys(strategies)) state[k] = { touched:{}, traded:false };

      for(let ri=1; ri<regIdx.length; ri++) {
        const ci=regIdx[ri], pci=regIdx[ri-1];
        const price=data5m.closes[ci], h=data5m.highs[ci], l=data5m.lows[ci], o=data5m.opens[ci], c=data5m.closes[ci];
        if(!price||!h||!l||!o) continue;
        const body=Math.abs(c-o), wU=h-Math.max(c,o), wD=Math.min(c,o)-l;
        const sd=getStop(price);
        const pH=data5m.highs[pci], pL=data5m.lows[pci];
        const cts=data5m.timestamps[ci];

        // EMA/VWAP at this candle
        const e10 = ema10[ci], e20 = ema20[ci];
        const e10slope = ci>=3 ? ema10[ci]-ema10[ci-3] : 0;
        const vwapIdx = indices.indexOf(ci);
        const vwap = vwapIdx >= 0 ? dayVwaps[vwapIdx] : null;

        for(const lv of levels) {
          let dir=null, type=null;
          if(h>lv.price&&pH!=null&&pH<=lv.price){dir='CALL';type='BRK';}
          else if(l<lv.price&&pL!=null&&pL>=lv.price){dir='PUT';type='BRK';}
          else if(l<=lv.price*1.002&&c>lv.price&&wD>body*2&&wD>0.10){dir='CALL';type='REJ';}
          else if(h>=lv.price*0.998&&c<lv.price&&wU>body*2&&wU>0.10){dir='PUT';type='REJ';}
          if(!dir) continue;
          if(dir==='CALL'&&dt==='DOWN') continue;
          if(dir==='PUT'&&dt==='UP') continue;

          const tk = `${lv.name}_${type}_${dir}`;
          const eod = regIdx[regIdx.length-1];

          // SPY+VIX convergence (all strategies use this)
          const conv = checkIdx(spy1m, cts, dir, false) && checkIdx(vix1m, cts, dir, true);
          if(!conv) continue;

          // EMA quality check
          const emaOk = dir==='CALL' ? (price>e10 && e10slope>0.02) : (price<e10 && e10slope<-0.02);
          // VWAP quality check
          const vwapOk = vwap ? (dir==='CALL' ? price>vwap : price<vwap) : true;

          // === COMBO: level + ema + vwap + spyvix + 1/ticker ===
          const s1 = state['COMBO (level+ema+vwap+spyvix+1/tkr)'];
          if(!s1.touched[tk] && !s1.traded && emaOk && vwapOk) {
            s1.touched[tk]=true; s1.traded=true;
            const res=simulateTrade(dir,price,sd,data5m,ci,eod);
            strategies['COMBO (level+ema+vwap+spyvix+1/tkr)'].push({
              date:dk,ticker,dir,type,level:lv.name,entry:+price.toFixed(2),
              pnl:+res.pnl.toFixed(2),exitType:res.type,
              result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS'
            });
            tc++;
          }

          // === COMBO sin VWAP ===
          const s2 = state['COMBO sin VWAP'];
          if(!s2.touched[tk] && !s2.traded && emaOk) {
            s2.touched[tk]=true; s2.traded=true;
            const res=simulateTrade(dir,price,sd,data5m,ci,eod);
            strategies['COMBO sin VWAP'].push({
              date:dk,ticker,dir,type,level:lv.name,entry:+price.toFixed(2),
              pnl:+res.pnl.toFixed(2),exitType:res.type,
              result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS'
            });
          }

          // === COMBO sin EMA ===
          const s3 = state['COMBO sin EMA'];
          if(!s3.touched[tk] && !s3.traded && vwapOk) {
            s3.touched[tk]=true; s3.traded=true;
            const res=simulateTrade(dir,price,sd,data5m,ci,eod);
            strategies['COMBO sin EMA'].push({
              date:dk,ticker,dir,type,level:lv.name,entry:+price.toFixed(2),
              pnl:+res.pnl.toFixed(2),exitType:res.type,
              result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS'
            });
          }

          // === Baseline: Ultra Simple SPY+VIX (no ema/vwap, no 1/ticker limit) ===
          const s4 = state['Ultra Simple SPY+VIX (baseline)'];
          if(!s4.touched[tk]) {
            s4.touched[tk]=true;
            const res=simulateTrade(dir,price,sd,data5m,ci,eod);
            strategies['Ultra Simple SPY+VIX (baseline)'].push({
              date:dk,ticker,dir,type,level:lv.name,entry:+price.toFixed(2),
              pnl:+res.pnl.toFixed(2),exitType:res.type,
              result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS'
            });
          }
        }
      }
    }
    console.log(`${tc} combo`);
    await new Promise(r=>setTimeout(r,200));
  }

  console.log('\n'+'='.repeat(90));
  console.log('COMPARACION — 1 mes, 10 tickers');
  console.log('Todas usan: niveles + merge + tendencia diaria + SPY+VIX convergencia');
  console.log('='.repeat(90));

  for(const [name, trades] of Object.entries(strategies)) {
    const w=trades.filter(t=>t.result==='WIN').length;
    const l=trades.filter(t=>t.result==='LOSS').length;
    const b=trades.filter(t=>t.result==='BE').length;
    const pnl=trades.reduce((s,t)=>s+t.pnl,0);
    const gw=trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gl=Math.abs(trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    const days=new Set(trades.map(t=>t.date)).size;
    const pf=gl>0?(gw/gl).toFixed(2):gw>0?'∞':'0';
    const nlr=trades.length?((1-l/trades.length)*100).toFixed(1):0;
    const tpd=days?(trades.length/days).toFixed(1):0;

    console.log(`\n${name}`);
    console.log(`  Trades: ${String(trades.length).padStart(3)} | W:${String(w).padStart(3)} L:${String(l).padStart(3)} BE:${String(b).padStart(3)} | WR ${((w/(trades.length||1))*100).toFixed(0).padStart(2)}% | NLR ${nlr.padStart(5)}% | PF ${pf.padStart(5)} | $${pnl.toFixed(2).padStart(8)} | ${tpd}/day`);
  }
}

run().catch(console.error);
