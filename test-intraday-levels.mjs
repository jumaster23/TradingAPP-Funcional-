// INTRADAY LEVELS + SPY/VIX convergence
// Detect: consolidation breakouts, swing high/low breaks, PDH/PDL/PMH/PML
// Combined with SPY+VIX inverse convergence

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

async function fetch1minWeek(ticker){return fetchChart(ticker,'1m','8d');}

function getStop(p){return p<100?0.5:p<250?1:p<400?1.5:p<550?2:2.5;}
function calcEMA(a,p){if(!a||a.length<p)return[];const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}

function checkIdx(data,ts,dir,inv){
  let idx=-1;for(let i=data.timestamps.length-1;i>=0;i--){if(data.timestamps[i]<=ts){idx=i;break;}}
  if(idx<3)return false;const c=data.closes;if(c[idx]==null||c[idx-1]==null||c[idx-3]==null)return false;
  const p=c[idx],t3=p-c[idx-3],t1=p-c[idx-1],th=p*0.00003;
  if(inv)return dir==='CALL'?(t3<-th&&t1<=0):(t3>th&&t1>=0);
  return dir==='CALL'?(t3>th&&t1>=0):(t3<-th&&t1<=0);}

function simulateTrade(dir, entry, sd, data, si, ei) {
  const tgt=dir==='CALL'?entry+sd*2:entry-sd*2; // 1:2 target
  let stop=dir==='CALL'?entry-sd:entry+sd, be=false;
  for(let j=si+1;j<=ei;j++){
    const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){if(h>=entry+sd&&!be){stop=entry;be=true;}if(l<=stop)return{pnl:stop-entry,type:be?'BE':'STOP'};if(h>=tgt)return{pnl:tgt-entry,type:'TARGET'};}
    else{if(entry-l>=sd&&!be){stop=entry;be=true;}if(h>=stop)return{pnl:entry-stop,type:be?'BE':'STOP'};if(l<=tgt)return{pnl:entry-tgt,type:'TARGET'};}
  }
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD'};}

function mergeLevels(levels){
  const pri={PDH:3,PDL:3,PMH:2,PML:2,SH:1,SL:1,CH:1,CL:1};
  const sorted=[...levels].sort((a,b)=>a.price-b.price);
  const merged=[],used=new Set();
  for(let i=0;i<sorted.length;i++){if(used.has(i))continue;let best=sorted[i];
    for(let j=i+1;j<sorted.length;j++){if(used.has(j))continue;
      if(Math.abs(sorted[j].price-best.price)/best.price<0.003){
        if((pri[sorted[j].name]||0)>(pri[best.name]||0)){used.add(i);best=sorted[j];}used.add(j);}}
    merged.push(best);}return merged;}

async function run(){
  console.log('Loading SPY+VIX 1min...');
  const [spy1m, vix1m] = await Promise.all([fetch1minWeek('SPY'), fetch1minWeek('^VIX')]);
  console.log(`SPY:${spy1m?.timestamps.length||0} VIX:${vix1m?.timestamps.length||0}`);

  const allTrades = [];

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);
    const [data5m, dailyData] = await Promise.all([
      fetchChart(ticker,'5m','10d'),
      fetchChart(ticker,'1d','3mo'),
    ]);
    if (!data5m || data5m.timestamps.length<100) { console.log('skip'); continue; }

    const days = groupByDay(data5m.timestamps);
    const dayKeys = Object.keys(days).sort().slice(-8);
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[];
    const dTs=dailyData?dailyData.timestamps:[];const dEma10=calcEMA(dCloses,10);

    function getDayTrend(dk){if(dCloses.length<12)return'NEUTRAL';const ts=new Date(dk+'T12:00:00').getTime()/1000;let idx=-1;for(let i=dTs.length-1;i>=0;i--){if(dTs[i]<=ts+86400){idx=i;break;}}if(idx<10)return'NEUTRAL';if(dCloses[idx]>dEma10[idx]&&dCloses[idx-1]>dCloses[idx-2])return'UP';if(dCloses[idx]<dEma10[idx]&&dCloses[idx-1]<dCloses[idx-2])return'DOWN';return'NEUTRAL';}

    const allDayKeys = Object.keys(days).sort();
    let tc=0;

    for (const dk of dayKeys) {
      const indices = days[dk];
      if (!indices || indices.length < 30) continue;
      const dt = getDayTrend(dk);

      // Previous day for PDH/PDL
      const prevDk = allDayKeys[allDayKeys.indexOf(dk)-1];
      const prevIndices = prevDk ? days[prevDk] : null;

      let staticLevels = [];

      // PDH/PDL from previous day
      if (prevIndices) {
        let pdh=-Infinity, pdl=Infinity;
        for(const pi of prevIndices){const m=getMinutesET(data5m.timestamps[pi]);if(m>=570&&m<960){if(data5m.highs[pi]!=null&&data5m.highs[pi]>pdh)pdh=data5m.highs[pi];if(data5m.lows[pi]!=null&&data5m.lows[pi]<pdl)pdl=data5m.lows[pi];}}
        if(pdh!==-Infinity){staticLevels.push({name:'PDH',price:+pdh.toFixed(2)});staticLevels.push({name:'PDL',price:+pdl.toFixed(2)});}
      }

      // PMH/PML
      let pmh=-Infinity,pml=Infinity,pmc=0;
      for(const ci of indices){const m=getMinutesET(data5m.timestamps[ci]);if(m>=240&&m<570){if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];pmc++;}}
      if(pmc>=3&&pmh!==-Infinity){staticLevels.push({name:'PMH',price:+pmh.toFixed(2)});staticLevels.push({name:'PML',price:+pml.toFixed(2)});}

      // Regular hours
      const regIdx = indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<955;});
      if (regIdx.length < 15) continue;

      const touched = {};
      let traded = false;

      for (let ri=8; ri<regIdx.length-3; ri++) {
        if (traded) break;
        const ci = regIdx[ri];
        const price = data5m.closes[ci];
        const h = data5m.highs[ci], l = data5m.lows[ci];
        if (!price || !h || !l) continue;
        const prevH = data5m.highs[regIdx[ri-1]];
        const prevL = data5m.lows[regIdx[ri-1]];
        const sd = getStop(price);
        const cts = data5m.timestamps[ci];
        const time = new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        // === DETECT INTRADAY LEVELS (5min) ===
        // Swing highs: candle[i-2].high < candle[i-1].high > candle[i].high (confirmed swing)
        const dynamicLevels = [];
        for (let j = ri-2; j >= Math.max(2, ri-20); j--) {
          const jci = regIdx[j];
          const jH = data5m.highs[jci], jL = data5m.lows[jci];
          const prevJH = data5m.highs[regIdx[j-1]], nextJH = data5m.highs[regIdx[j+1]];
          const prevJL = data5m.lows[regIdx[j-1]], nextJL = data5m.lows[regIdx[j+1]];
          if (jH!=null && prevJH!=null && nextJH!=null && jH > prevJH && jH > nextJH) {
            dynamicLevels.push({name:'SH',price:+jH.toFixed(2)});
          }
          if (jL!=null && prevJL!=null && nextJL!=null && jL < prevJL && jL < nextJL) {
            dynamicLevels.push({name:'SL',price:+jL.toFixed(2)});
          }
        }

        // Consolidation range: last 6 candles tight range, current breaks out
        const consStart = Math.max(0, ri-6);
        const consCandles = regIdx.slice(consStart, ri);
        if (consCandles.length >= 4) {
          const cHighs = consCandles.map(ci2=>data5m.highs[ci2]).filter(v=>v!=null);
          const cLows = consCandles.map(ci2=>data5m.lows[ci2]).filter(v=>v!=null);
          if (cHighs.length >= 4) {
            const cH = Math.max(...cHighs), cL = Math.min(...cLows);
            const cRange = (cH - cL) / price * 100;
            if (cRange < 0.5 && cRange > 0.05) { // tight consolidation
              dynamicLevels.push({name:'CH',price:+cH.toFixed(2)});
              dynamicLevels.push({name:'CL',price:+cL.toFixed(2)});
            }
          }
        }

        // Combine static + dynamic, merge nearby
        const allLevels = mergeLevels([...staticLevels, ...dynamicLevels]);

        // Check breakout/rejection at each level
        for (const lv of allLevels) {
          let dir = null, type = null;

          // Breakout up
          if (h > lv.price && prevH != null && prevH <= lv.price) { dir='CALL'; type='BRK'; }
          // Breakout down
          else if (l < lv.price && prevL != null && prevL >= lv.price) { dir='PUT'; type='BRK'; }

          if (!dir) continue;
          const tk = `${lv.name}_${lv.price}_${dir}`;
          if (touched[tk]) continue;

          // Trend filter
          if (dir==='CALL' && dt==='DOWN') continue;
          if (dir==='PUT' && dt==='UP') continue;

          // SPY + VIX convergence
          if (!checkIdx(spy1m, cts, dir, false)) continue;
          if (!checkIdx(vix1m, cts, dir, true)) continue;

          touched[tk] = true;

          const eod = regIdx[regIdx.length-1];
          const res = simulateTrade(dir, price, sd, data5m, ci, eod);

          allTrades.push({
            date:dk, time, ticker, dir, type,
            level:lv.name, levelPrice:lv.price,
            entry:+price.toFixed(2),
            sl:+(dir==='CALL'?price-sd:price+sd).toFixed(2),
            tp:+(dir==='CALL'?price+sd*2:price-sd*2).toFixed(2),
            pnl:+res.pnl.toFixed(2), exitType:res.type,
            result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
            dayTrend:dt,
          });
          traded = true; tc++;
          break; // one trade per candle
        }
      }
    }
    console.log(`${tc} trades`);
    await new Promise(r=>setTimeout(r,200));
  }

  allTrades.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));

  const MULT = 0.50*2*100/2;
  console.log('\n'+'='.repeat(130));
  console.log('INTRADAY LEVELS (PDH/PDL/PMH/PML + Swing H/L + Consolidation) + SPY+VIX + Trend');
  console.log('Target 1:2 | BE 1x | Max 1/ticker/día');
  console.log('='.repeat(130));

  let currentDay='';
  console.log(`\n${'Fecha'.padEnd(11)} ${'Hora'.padEnd(9)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Tipo'.padEnd(4)} ${'Nivel'.padEnd(4)} ${'LvlPrice'.padEnd(9)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP'.padEnd(9)} ${'PnL'.padEnd(8)} ${'$2c'.padEnd(7)} ${'Res'.padEnd(6)} Trend`);
  console.log('-'.repeat(120));

  for(const t of allTrades){
    if(t.date!==currentDay&&currentDay){
      const dTrades=allTrades.filter(x=>x.date===currentDay);
      const dp=dTrades.reduce((s,x)=>s+x.pnl,0)*MULT;
      const dw=dTrades.filter(x=>x.result==='WIN').length;
      const dl=dTrades.filter(x=>x.result==='LOSS').length;
      console.log(`${''.padEnd(80)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)} (${dw}W ${dl}L)`);
      console.log('');
    }
    currentDay=t.date;
    const cp=t.pnl*MULT;
    const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
    console.log(`${t.date.padEnd(11)} ${t.time.padEnd(9)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} ${t.type.padEnd(4)} ${t.level.padEnd(4)} $${String(t.levelPrice).padEnd(8)} $${String(t.entry).padEnd(8)} $${String(t.sl).padEnd(8)} $${String(t.tp).padEnd(8)} ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${(cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(4)} ${icon}${t.result.padEnd(5)} ${t.dayTrend}`);
  }
  // Last day
  {const dTrades=allTrades.filter(x=>x.date===currentDay);const dp=dTrades.reduce((s,x)=>s+x.pnl,0)*MULT;const dw=dTrades.filter(x=>x.result==='WIN').length;const dl=dTrades.filter(x=>x.result==='LOSS').length;
  console.log(`${''.padEnd(80)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)} (${dw}W ${dl}L)`);}

  // Summary
  const w=allTrades.filter(t=>t.result==='WIN').length;
  const l=allTrades.filter(t=>t.result==='LOSS').length;
  const b=allTrades.filter(t=>t.result==='BE').length;
  const pnl=allTrades.reduce((s,t)=>s+t.pnl,0);
  const cpnl=pnl*MULT;
  const gw=allTrades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const gl=Math.abs(allTrades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
  const days=new Set(allTrades.map(t=>t.date)).size;

  // By level type
  console.log('\n--- POR TIPO DE NIVEL ---');
  for (const lvl of ['PDH','PDL','PMH','PML','SH','SL','CH','CL']) {
    const lt = allTrades.filter(t=>t.level===lvl);
    if (!lt.length) continue;
    const lw=lt.filter(t=>t.result==='WIN').length;
    const ll=lt.filter(t=>t.result==='LOSS').length;
    const lp=lt.reduce((s,t)=>s+t.pnl,0);
    console.log(`  ${lvl.padEnd(4)}: ${lt.length} trades | ${lw}W ${ll}L | WR ${((lw/lt.length)*100).toFixed(0)}% | PnL $${(lp*MULT).toFixed(0)}`);
  }

  console.log('\n'+'='.repeat(130));
  console.log(`TOTAL: ${allTrades.length} trades en ${days} días | ${w}W ${l}L ${b}BE | WR ${((w/allTrades.length)*100).toFixed(0)}% | PF ${gl>0?(gw/gl).toFixed(2):'∞'}`);
  console.log(`Stock PnL: $${pnl.toFixed(2)} | 2 contratos: $${cpnl.toFixed(0)} | Promedio: $${(cpnl/days).toFixed(0)}/día`);
}

run().catch(console.error);
