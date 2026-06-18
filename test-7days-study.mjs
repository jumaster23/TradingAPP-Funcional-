// STUDY: Last 7 trading days — every trade, premarket behavior, day quality
// Goal: Find what premarket signals predict bad days

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

async function fetch1minWeek(ticker){
  const now=Math.floor(Date.now()/1000);
  return fetchChart(ticker,'1m',null,now-8*86400,now);
}

function fetchChart2(ticker,interval,range,p1,p2){
  return fetchChart(ticker,interval,null).then(()=>null).catch(()=>null);
}

function getStop(p){return p<100?0.5:p<250?1:p<400?1.5:p<550?2:2.5;}
function calcEMA(a,p){if(!a||a.length<p)return[];const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}
function checkIdx(data,ts,dir,inv){let idx=-1;for(let i=data.timestamps.length-1;i>=0;i--){if(data.timestamps[i]<=ts){idx=i;break;}}if(idx<3)return false;const c=data.closes;if(c[idx]==null||c[idx-1]==null||c[idx-3]==null)return false;const p=c[idx],t3=p-c[idx-3],t1=p-c[idx-1],th=p*0.00003;if(inv)return dir==='CALL'?(t3<-th&&t1<=0):(t3>th&&t1>=0);return dir==='CALL'?(t3>th&&t1>=0):(t3<-th&&t1<=0);}
function mergeLevels(levels){const pri={PDH:3,PDL:3,PMH:2,PML:2};const sorted=[...levels].sort((a,b)=>a.price-b.price);const merged=[],used=new Set();for(let i=0;i<sorted.length;i++){if(used.has(i))continue;let best=sorted[i];for(let j=i+1;j<sorted.length;j++){if(used.has(j))continue;if(Math.abs(sorted[j].price-best.price)/best.price<0.005){if((pri[sorted[j].name]||0)>(pri[best.name]||0)){used.add(i);best=sorted[j];}used.add(j);}}merged.push(best);}return merged;}

function simulateTrade(dir, entry, sd, targetMult, data, si, ei) {
  const tgt=dir==='CALL'?entry+sd*targetMult:entry-sd*targetMult;
  let stop=dir==='CALL'?entry-sd:entry+sd, be=false, maxFav=0;
  for(let j=si+1;j<=ei;j++){
    const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){maxFav=Math.max(maxFav,h-entry);if(h>=entry+sd&&!be){stop=entry;be=true;}if(l<=stop)return{pnl:stop-entry,type:be?'BE':'STOP',maxFav,exitIdx:j};if(h>=tgt)return{pnl:tgt-entry,type:'TARGET',maxFav,exitIdx:j};}
    else{maxFav=Math.max(maxFav,entry-l);if(entry-l>=sd&&!be){stop=entry;be=true;}if(h>=stop)return{pnl:entry-stop,type:be?'BE':'STOP',maxFav,exitIdx:j};if(l<=tgt)return{pnl:entry-tgt,type:'TARGET',maxFav,exitIdx:j};}}
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD',maxFav,exitIdx:ei};}

async function run(){
  console.log('Loading 1min data for convergence...');
  const now=Math.floor(Date.now()/1000);
  const [spy1m, vix1m, spyData5m, vixData] = await Promise.all([
    fetchChart('SPY','1m','8d'),
    fetchChart('^VIX','1m','8d'),
    fetchChart('SPY','5m','10d'),
    fetchChart('^VIX','5m','10d'),
  ]);

  // === PREMARKET ANALYSIS for SPY and VIX ===
  const spyDays = groupByDay(spyData5m.timestamps);
  const vixDays = groupByDay(vixData.timestamps);
  const dayKeys = Object.keys(spyDays).sort().slice(-8); // last 8 days

  console.log('\n'+'='.repeat(120));
  console.log('PREMARKET ANALYSIS — SPY y VIX antes de apertura');
  console.log('='.repeat(120));

  const premarketData = {};

  for (const dk of dayKeys) {
    const spyIdx = spyDays[dk] || [];
    const vixIdx = vixDays[dk] || [];

    // SPY premarket (4:00-9:30)
    let spyPmH=-Infinity, spyPmL=Infinity, spyPmOpen=null, spyPmClose=null, spyPmCount=0;
    for (const ci of spyIdx) {
      const m = getMinutesET(spyData5m.timestamps[ci]);
      if (m >= 240 && m < 570) {
        if (spyData5m.closes[ci]!=null) {
          if (!spyPmOpen) spyPmOpen = spyData5m.opens[ci];
          spyPmClose = spyData5m.closes[ci];
          if (spyData5m.highs[ci] > spyPmH) spyPmH = spyData5m.highs[ci];
          if (spyData5m.lows[ci] < spyPmL) spyPmL = spyData5m.lows[ci];
          spyPmCount++;
        }
      }
    }

    // SPY previous close
    const spyRegular = spyIdx.filter(ci => { const m=getMinutesET(spyData5m.timestamps[ci]); return m>=570&&m<960; });
    const spyOpen = spyRegular.length ? spyData5m.opens[spyRegular[0]] : null;
    const spyClose = spyRegular.length ? spyData5m.closes[spyRegular[spyRegular.length-1]] : null;
    const spyDayHigh = spyRegular.length ? Math.max(...spyRegular.map(ci=>spyData5m.highs[ci]).filter(v=>v!=null)) : null;
    const spyDayLow = spyRegular.length ? Math.min(...spyRegular.map(ci=>spyData5m.lows[ci]).filter(v=>v!=null)) : null;

    // VIX premarket
    let vixPmOpen=null, vixPmClose=null;
    for (const ci of vixIdx) {
      const m = getMinutesET(vixData.timestamps[ci]);
      if (m >= 240 && m < 570 && vixData.closes[ci]!=null) {
        if (!vixPmOpen) vixPmOpen = vixData.opens[ci];
        vixPmClose = vixData.closes[ci];
      }
    }

    // VIX at open
    const vixRegular = vixIdx.filter(ci => { const m=getMinutesET(vixData.timestamps[ci]); return m>=570&&m<960; });
    const vixOpen = vixRegular.length ? vixData.opens[vixRegular[0]] : null;
    const vixClose = vixRegular.length ? vixData.closes[vixRegular[vixRegular.length-1]] : null;

    const spyPmRange = spyPmH!==-Infinity ? ((spyPmH-spyPmL)/spyPmOpen*100).toFixed(2) : null;
    const spyPmChange = spyPmOpen && spyPmClose ? ((spyPmClose-spyPmOpen)/spyPmOpen*100).toFixed(2) : null;
    const spyGap = spyOpen && spyPmClose ? ((spyOpen-spyPmClose)/spyPmClose*100).toFixed(2) : null;
    const vixPmChange = vixPmOpen && vixPmClose ? ((vixPmClose-vixPmOpen)/vixPmOpen*100).toFixed(2) : null;
    const spyDayRange = spyDayHigh && spyDayLow ? ((spyDayHigh-spyDayLow)/spyOpen*100).toFixed(2) : null;
    const spyDayChange = spyOpen && spyClose ? ((spyClose-spyOpen)/spyOpen*100).toFixed(2) : null;

    premarketData[dk] = {
      spyPmRange, spyPmChange, spyGap, vixPmChange, vixOpen, vixClose,
      spyDayRange, spyDayChange, spyOpen, spyClose,
    };
  }

  // === TRADES for each day ===
  const allTrades = [];

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);
    const [data5m, dailyData] = await Promise.all([
      fetchChart(ticker,'5m','10d'),
      fetchChart(ticker,'1d','3mo'),
    ]);
    if (!data5m || data5m.timestamps.length<50) { console.log('skip'); continue; }
    const days = groupByDay(data5m.timestamps);
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[]; const dTs=dailyData?dailyData.timestamps:[]; const dEma10=calcEMA(dCloses,10);
    function getDayTrend(dk){if(dCloses.length<12)return'NEUTRAL';const ts=new Date(dk+'T12:00:00').getTime()/1000;let idx=-1;for(let i=dTs.length-1;i>=0;i--){if(dTs[i]<=ts+86400){idx=i;break;}}if(idx<10)return'NEUTRAL';if(dCloses[idx]>dEma10[idx]&&dCloses[idx-1]>dCloses[idx-2])return'UP';if(dCloses[idx]<dEma10[idx]&&dCloses[idx-1]<dCloses[idx-2])return'DOWN';return'NEUTRAL';}

    const allDayKeys = Object.keys(days).sort();
    let tc=0;
    for (let di=1; di<allDayKeys.length; di++) {
      const dk=allDayKeys[di], pdk=allDayKeys[di-1];
      if (!dayKeys.includes(dk)) continue; // only last 7-8 days
      const indices=days[dk], prevIndices=days[pdk];
      if (!prevIndices||indices.length<15) continue;

      let rawLevels=[];let pdh=-Infinity,pdl=Infinity;
      for(const pi of prevIndices){const m=getMinutesET(data5m.timestamps[pi]);if(m>=570&&m<960){if(data5m.highs[pi]!=null&&data5m.highs[pi]>pdh)pdh=data5m.highs[pi];if(data5m.lows[pi]!=null&&data5m.lows[pi]<pdl)pdl=data5m.lows[pi];}}
      if(pdh!==-Infinity){rawLevels.push({name:'PDH',price:+pdh.toFixed(2)});rawLevels.push({name:'PDL',price:+pdl.toFixed(2)});}
      let pmh=-Infinity,pml=Infinity,pmc=0;
      for(const ci of indices){const m=getMinutesET(data5m.timestamps[ci]);if(m>=240&&m<570){if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];pmc++;}}
      if(pmc>=3&&pmh!==-Infinity){rawLevels.push({name:'PMH',price:+pmh.toFixed(2)});rawLevels.push({name:'PML',price:+pml.toFixed(2)});}
      const levels=mergeLevels(rawLevels);if(!levels.length)continue;
      const dt=getDayTrend(dk);const touched={};
      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<955;});

      for(let ri=1;ri<regIdx.length;ri++){
        const ci=regIdx[ri],pci=regIdx[ri-1];
        const price=data5m.closes[ci],h=data5m.highs[ci],l=data5m.lows[ci],o=data5m.opens[ci],c=data5m.closes[ci];
        if(!price||!h||!l||!o)continue;
        const body=Math.abs(c-o),wU=h-Math.max(c,o),wD=Math.min(c,o)-l;
        const sd=getStop(price);const pH=data5m.highs[pci],pL=data5m.lows[pci];
        const cts=data5m.timestamps[ci];
        const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        for(const lv of levels){
          let dir=null,type=null;
          if(h>lv.price&&pH!=null&&pH<=lv.price){dir='CALL';type='BRK';}
          else if(l<lv.price&&pL!=null&&pL>=lv.price){dir='PUT';type='BRK';}
          else if(l<=lv.price*1.002&&c>lv.price&&wD>body*2&&wD>0.10){dir='CALL';type='REJ';}
          else if(h>=lv.price*0.998&&c<lv.price&&wU>body*2&&wU>0.10){dir='PUT';type='REJ';}
          if(!dir)continue;
          const tk=`${lv.name}_${type}_${dir}`;if(touched[tk])continue;
          if(dir==='CALL'&&dt==='DOWN')continue;
          if(dir==='PUT'&&dt==='UP')continue;
          if(!checkIdx(spy1m,cts,dir,false))continue;
          if(!checkIdx(vix1m,cts,dir,true))continue;
          touched[tk]=true;tc++;

          // Test both 1:2 and 1:3
          const res2=simulateTrade(dir,price,sd,2,data5m,ci,regIdx[regIdx.length-1]);
          const res3=simulateTrade(dir,price,sd,3,data5m,ci,regIdx[regIdx.length-1]);
          const exitTime=new Date(data5m.timestamps[res2.exitIdx]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

          allTrades.push({
            date:dk,time,exitTime,ticker,dir,type,level:lv.name,levelPrice:lv.price,
            entry:+price.toFixed(2),sd,
            pnl2:+res2.pnl.toFixed(2), exit2:res2.type, result2:res2.pnl>0?'WIN':res2.pnl===0?'BE':'LOSS',
            pnl3:+res3.pnl.toFixed(2), exit3:res3.type, result3:res3.pnl>0?'WIN':res3.pnl===0?'BE':'LOSS',
            maxFav:+res2.maxFav.toFixed(2), dayTrend:dt,
          });
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  allTrades.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));

  // === DISPLAY DAY BY DAY ===
  const MULT = 0.50 * 2 * 100 / 2; // delta * contracts * 100 / contracts

  console.log('\n'+'='.repeat(140));
  console.log('DIA A DIA — Últimos 7 días con premarket analysis');
  console.log('='.repeat(140));

  const tradeDays = [...new Set(allTrades.map(t=>t.date))].sort();

  for (const dk of tradeDays) {
    const pm = premarketData[dk] || {};
    const dayTrades = allTrades.filter(t=>t.date===dk);

    // Day stats with 1:2
    const w2=dayTrades.filter(t=>t.result2==='WIN').length;
    const l2=dayTrades.filter(t=>t.result2==='LOSS').length;
    const b2=dayTrades.filter(t=>t.result2==='BE').length;
    const pnl2=dayTrades.reduce((s,t)=>s+t.pnl2,0);
    const cpnl2=pnl2*MULT;

    // Determine day quality
    let quality = '🟢 BUENO';
    if (cpnl2 < -100) quality = '🔴 MALO';
    else if (cpnl2 < 0) quality = '🟡 FLOJO';

    console.log(`\n${'═'.repeat(140)}`);
    console.log(`${dk} ${quality} | PnL(1:2): ${cpnl2>=0?'+':''}$${cpnl2.toFixed(0)} | ${w2}W ${l2}L ${b2}BE | ${dayTrades.length} trades`);
    console.log(`  PREMARKET: SPY rango ${pm.spyPmRange||'?'}% | SPY cambio ${pm.spyPmChange||'?'}% | Gap ${pm.spyGap||'?'}% | VIX cambio ${pm.vixPmChange||'?'}%`);
    console.log(`  DIA:       SPY rango ${pm.spyDayRange||'?'}% | SPY cambio ${pm.spyDayChange||'?'}% | VIX open $${pm.vixOpen?.toFixed(1)||'?'} close $${pm.vixClose?.toFixed(1)||'?'}`);
    console.log(`${'─'.repeat(140)}`);
    console.log(`  ${'Hora'.padEnd(9)} ${'Ticker'.padEnd(6)} ${'Dir'.padEnd(5)} ${'Tipo'.padEnd(4)} ${'Nivel'.padEnd(12)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP(2x)'.padEnd(9)} ${'PnL(2x)'.padEnd(9)} ${'Res(2x)'.padEnd(8)} ${'PnL(3x)'.padEnd(9)} ${'Res(3x)'.padEnd(8)} ${'MaxFav'.padEnd(7)} Trend`);

    for (const t of dayTrades) {
      const sl = t.dir==='CALL' ? t.entry-t.sd : t.entry+t.sd;
      const tp2 = t.dir==='CALL' ? t.entry+t.sd*2 : t.entry-t.sd*2;
      const i2=t.result2==='WIN'?'✅':t.result2==='BE'?'⚪':'❌';
      const i3=t.result3==='WIN'?'✅':t.result3==='BE'?'⚪':'❌';
      console.log(`  ${t.time.padEnd(9)} ${t.ticker.padEnd(6)} ${t.dir.padEnd(5)} ${t.type.padEnd(4)} ${(t.level+' $'+t.levelPrice).padEnd(12)} $${String(t.entry).padEnd(8)} $${String(sl.toFixed(2)).padEnd(8)} $${String(tp2.toFixed(2)).padEnd(8)} ${(t.pnl2>=0?'+':'')+t.pnl2.toFixed(2).padStart(6)}   ${i2}${t.result2.padEnd(5)}  ${(t.pnl3>=0?'+':'')+t.pnl3.toFixed(2).padStart(6)}   ${i3}${t.result3.padEnd(5)}  $${t.maxFav.toFixed(2).padStart(5)} ${t.dayTrend}`);
    }
  }

  // === PATTERN ANALYSIS ===
  console.log('\n\n'+'='.repeat(100));
  console.log('PATRONES PREMARKET → CALIDAD DEL DIA');
  console.log('='.repeat(100));

  for (const dk of tradeDays) {
    const pm = premarketData[dk] || {};
    const dayTrades = allTrades.filter(t=>t.date===dk);
    const pnl2 = dayTrades.reduce((s,t)=>s+t.pnl2,0)*MULT;
    const w = dayTrades.filter(t=>t.result2==='WIN').length;
    const l = dayTrades.filter(t=>t.result2==='LOSS').length;

    const alerts = [];
    if (pm.spyPmRange && +pm.spyPmRange < 0.15) alerts.push('PM rango estrecho (<0.15%)');
    if (pm.spyPmRange && +pm.spyPmRange > 0.8) alerts.push('PM rango amplio (>0.8%)');
    if (pm.vixPmChange && +pm.vixPmChange > 3) alerts.push('VIX PM subió >3%');
    if (pm.vixPmChange && +pm.vixPmChange < -3) alerts.push('VIX PM bajó >3%');
    if (pm.spyGap && Math.abs(+pm.spyGap) > 0.5) alerts.push(`Gap grande: ${pm.spyGap}%`);
    if (pm.vixOpen && +pm.vixOpen > 25) alerts.push('VIX alto (>25)');

    const icon = pnl2 > 100 ? '🟢' : pnl2 > 0 ? '🟡' : pnl2 > -100 ? '🟠' : '🔴';
    console.log(`${icon} ${dk} | ${pnl2>=0?'+':''}$${pnl2.toFixed(0).padStart(5)} | ${w}W ${l}L | PM: SPY ${pm.spyPmChange||'?'}% VIX ${pm.vixPmChange||'?'}% range ${pm.spyPmRange||'?'}% | ${alerts.join(', ') || 'Normal'}`);
  }
}

run().catch(console.error);
