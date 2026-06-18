// TODAY's trades: Trend + SPY+VIX + levels + merge + target 1:2 + BE at 1x + max 3/day

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

function getStop(p){return p<100?0.5:p<250?1:p<400?1.5:p<550?2:2.5;}
function calcEMA(a,p){const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}

function checkIdx(data,ts,dir,inv){
  let idx=-1;for(let i=data.timestamps.length-1;i>=0;i--){if(data.timestamps[i]<=ts){idx=i;break;}}
  if(idx<3)return false;const c=data.closes;if(c[idx]==null||c[idx-1]==null||c[idx-3]==null)return false;
  const p=c[idx],t3=p-c[idx-3],t1=p-c[idx-1],th=p*0.00003;
  if(inv)return dir==='CALL'?(t3<-th&&t1<=0):(t3>th&&t1>=0);
  return dir==='CALL'?(t3>th&&t1>=0):(t3<-th&&t1<=0);}

function mergeLevels(levels){
  const pri={PDH:3,PDL:3,PMH:2,PML:2};const sorted=[...levels].sort((a,b)=>a.price-b.price);
  const merged=[],used=new Set();
  for(let i=0;i<sorted.length;i++){if(used.has(i))continue;let best=sorted[i];
    for(let j=i+1;j<sorted.length;j++){if(used.has(j))continue;if(Math.abs(sorted[j].price-best.price)/best.price<0.005){if((pri[sorted[j].name]||0)>(pri[best.name]||0)){used.add(i);best=sorted[j];}used.add(j);}}
    merged.push(best);}return merged;}

// TARGET 1:2, BE at 1x
function simulateTrade(dir, entry, sd, data, si, ei) {
  const tgt = dir==='CALL' ? entry + sd*2 : entry - sd*2;  // 2x target
  const beLevel = dir==='CALL' ? entry + sd : entry - sd;    // BE at 1x
  let stop = dir==='CALL' ? entry-sd : entry+sd;
  let be = false, maxFav = 0;
  for (let j=si+1; j<=ei; j++) {
    const h=data.highs[j], l=data.lows[j]; if(h==null||l==null)continue;
    if (dir==='CALL') {
      maxFav=Math.max(maxFav,h-entry);
      if (h >= beLevel && !be) { stop=entry; be=true; }
      if (l <= stop) return { pnl:stop-entry, type:be?'BE':'STOP', maxFav, exitIdx:j };
      if (h >= tgt) return { pnl:tgt-entry, type:'TARGET', maxFav, exitIdx:j };
    } else {
      maxFav=Math.max(maxFav,entry-l);
      if (entry-l >= sd && !be) { stop=entry; be=true; }
      if (h >= stop) return { pnl:entry-stop, type:be?'BE':'STOP', maxFav, exitIdx:j };
      if (l <= tgt) return { pnl:entry-tgt, type:'TARGET', maxFav, exitIdx:j };
    }
  }
  const ep=data.closes[ei]||entry;
  return { pnl:dir==='CALL'?ep-entry:entry-ep, type:'OPEN', maxFav, exitIdx:ei };
}

async function run() {
  const today = new Date().toISOString().slice(0,10);
  console.log(`\nTRADES DE HOY (${today}) — Estrategia final`);
  console.log('Filtros: Tendencia diaria + SPY+VIX convergencia + Niveles merge + First-touch');
  console.log('Risk: Target 2x stop, BE a 1x stop, Max 3 trades/día');
  console.log('='.repeat(100));

  const [spy1m, vix1m] = await Promise.all([
    fetchChart('SPY','1m','5d'),
    fetchChart('^VIX','1m','5d'),
  ]);

  const allTrades = [];

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);
    const [data5m, dailyData] = await Promise.all([
      fetchChart(ticker,'5m','2d'),
      fetchChart(ticker,'1d','3mo'),
    ]);
    if (!data5m) { console.log('skip'); continue; }

    // Day trend
    const dCloses = dailyData ? dailyData.closes.filter(v=>v!=null) : [];
    const dTs = dailyData ? dailyData.timestamps : [];
    const dEma10 = calcEMA(dCloses, 10);
    let dayTrend = 'NEUTRAL';
    if (dCloses.length >= 12) {
      const idx = dCloses.length - 1;
      if (dCloses[idx] > dEma10[idx] && dCloses[idx-1] > dCloses[idx-2]) dayTrend = 'UP';
      else if (dCloses[idx] < dEma10[idx] && dCloses[idx-1] < dCloses[idx-2]) dayTrend = 'DOWN';
    }

    const days = groupByDay(data5m.timestamps);
    const dayKeys = Object.keys(days).sort();
    const todayKey = dayKeys.find(k => k === today);
    const yesterdayKey = dayKeys[dayKeys.indexOf(todayKey) - 1];
    if (!todayKey || !yesterdayKey) { console.log('no data'); continue; }

    const todayIndices = days[todayKey];
    const yesterdayIndices = days[yesterdayKey];

    // Levels
    let rawLevels = [];
    let pdh=-Infinity, pdl=Infinity;
    for (const pi of yesterdayIndices) {
      const m = getMinutesET(data5m.timestamps[pi]);
      if (m >= 570 && m < 960) {
        if (data5m.highs[pi]!=null && data5m.highs[pi]>pdh) pdh=data5m.highs[pi];
        if (data5m.lows[pi]!=null && data5m.lows[pi]<pdl) pdl=data5m.lows[pi];
      }
    }
    if (pdh!==-Infinity) { rawLevels.push({name:'PDH',price:+pdh.toFixed(2)}); rawLevels.push({name:'PDL',price:+pdl.toFixed(2)}); }

    let pmh=-Infinity, pml=Infinity, pmc=0;
    for (const ci of todayIndices) {
      const m = getMinutesET(data5m.timestamps[ci]);
      if (m >= 240 && m < 570) {
        if (data5m.highs[ci]!=null && data5m.highs[ci]>pmh) pmh=data5m.highs[ci];
        if (data5m.lows[ci]!=null && data5m.lows[ci]<pml) pml=data5m.lows[ci];
        pmc++;
      }
    }
    if (pmc>=3 && pmh!==-Infinity) { rawLevels.push({name:'PMH',price:+pmh.toFixed(2)}); rawLevels.push({name:'PML',price:+pml.toFixed(2)}); }

    const levels = mergeLevels(rawLevels);
    const currentPrice = data5m.closes[todayIndices[todayIndices.length-1]];
    console.log(`trend=${dayTrend} $${currentPrice?.toFixed(2)} levels: ${levels.map(l=>`${l.name}=$${l.price}`).join(' ')}`);

    const regIndices = todayIndices.filter(ci => {
      const m = getMinutesET(data5m.timestamps[ci]);
      return m >= 575 && m < 955;
    });

    const touched = {};
    for (let ri=1; ri<regIndices.length; ri++) {
      const ci=regIndices[ri], pci=regIndices[ri-1];
      const price=data5m.closes[ci], h=data5m.highs[ci], l=data5m.lows[ci], o=data5m.opens[ci], c=data5m.closes[ci];
      if (!price||!h||!l||!o) continue;
      const body=Math.abs(c-o), wU=h-Math.max(c,o), wD=Math.min(c,o)-l;
      const sd=getStop(price);
      const pH=data5m.highs[pci], pL=data5m.lows[pci];
      const cts=data5m.timestamps[ci];
      const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

      for (const lv of levels) {
        let dir=null, type=null;
        if (h>lv.price && pH!=null && pH<=lv.price) { dir='CALL'; type='BRK'; }
        else if (l<lv.price && pL!=null && pL>=lv.price) { dir='PUT'; type='BRK'; }
        else if (l<=lv.price*1.002 && c>lv.price && wD>body*2 && wD>0.10) { dir='CALL'; type='REJ'; }
        else if (h>=lv.price*0.998 && c<lv.price && wU>body*2 && wU>0.10) { dir='PUT'; type='REJ'; }
        if (!dir) continue;
        const tk=`${lv.name}_${type}_${dir}`;
        if (touched[tk]) continue;

        // Filters
        if (dir==='CALL' && dayTrend==='DOWN') continue;
        if (dir==='PUT' && dayTrend==='UP') continue;
        if (!checkIdx(spy1m, cts, dir, false)) continue;
        if (!checkIdx(vix1m, cts, dir, true)) continue;
        touched[tk] = true;

        const eod = regIndices[regIndices.length-1];
        const res = simulateTrade(dir, price, sd, data5m, ci, eod);
        const exitTime = new Date(data5m.timestamps[res.exitIdx]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        allTrades.push({
          time, exitTime, ticker, dir, type, level:lv.name, levelPrice:lv.price,
          entry:+price.toFixed(2),
          sl:+(dir==='CALL'?price-sd:price+sd).toFixed(2),
          tp:+(dir==='CALL'?price+sd*2:price-sd*2).toFixed(2),
          be:+(dir==='CALL'?price+sd:price-sd).toFixed(2),
          exitPrice:+(dir==='CALL'?price+res.pnl:price-res.pnl).toFixed(2),
          pnl:+res.pnl.toFixed(2), exitType:res.type,
          result:res.pnl>0?'WIN':res.pnl===0?'BE':res.type==='OPEN'?'OPEN':'LOSS',
          maxFav:+res.maxFav.toFixed(2), dayTrend, sd,
        });
      }
    }
  }

  // Sort chronologically and take first 3
  allTrades.sort((a,b) => a.time.localeCompare(b.time));
  const taken = allTrades.slice(0, 3);
  const rest = allTrades.slice(3);

  const DELTA=0.50, CONTRACTS=2;

  console.log('\n'+'='.repeat(120));
  console.log(`TRADES DE HOY — ${allTrades.length} señales, tomamos las primeras 3`);
  console.log('='.repeat(120));

  console.log(`\n${'#'.padEnd(3)} ${'Hora'.padEnd(9)} ${'Exit'.padEnd(9)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Tipo'.padEnd(4)} ${'Nivel'.padEnd(12)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP(2x)'.padEnd(9)} ${'BE(1x)'.padEnd(9)} ${'ExitPr'.padEnd(9)} ${'PnL'.padEnd(8)} ${'2cont'.padEnd(8)} Resultado`);
  console.log('-'.repeat(120));

  let totalPnl = 0;
  for (let i=0; i<taken.length; i++) {
    const t = taken[i];
    const cp = t.pnl * DELTA * CONTRACTS * 100 / CONTRACTS;
    totalPnl += cp;
    const icon = t.result==='WIN'?'✅':t.result==='BE'?'⚪':t.result==='OPEN'?'🔵':'❌';
    console.log(
      `${String(i+1).padEnd(3)} ${t.time.padEnd(9)} ${t.exitTime.padEnd(9)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} ${t.type.padEnd(4)} ${(t.level+' $'+t.levelPrice).padEnd(12)} $${String(t.entry).padEnd(8)} $${String(t.sl).padEnd(8)} $${String(t.tp).padEnd(8)} $${String(t.be).padEnd(8)} $${String(t.exitPrice).padEnd(8)} ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${(cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(5)} ${icon} ${t.result}`
    );
  }

  console.log(`\n  TOTAL HOY (3 trades, 2 contratos): ${totalPnl>=0?'+':''}$${totalPnl.toFixed(0)}`);

  if (rest.length > 0) {
    console.log(`\n--- SEÑALES ADICIONALES (no tomadas por límite 3/día) ---`);
    for (const t of rest) {
      const cp = t.pnl * DELTA * CONTRACTS * 100 / CONTRACTS;
      const icon = t.result==='WIN'?'✅':t.result==='BE'?'⚪':t.result==='OPEN'?'🔵':'❌';
      console.log(`  ${t.time} ${t.ticker.padEnd(5)} ${t.dir.padEnd(4)} ${t.type} @${t.level} $${t.entry} → ${icon} ${t.result} $${t.pnl.toFixed(2)} (${(cp>=0?'+':'')+'$'+cp.toFixed(0)})`);
    }
  }
}

run().catch(console.error);
