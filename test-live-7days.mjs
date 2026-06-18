// Replicate /live smartEntry scoring for last 7 days
// Score: EMA10 trend(2), EMA10>20(1), VWAP(2), VWAP reclaim(3), SPY(2), Volume(1), Sweep(2), Bounce(1)
// Min score 5 to enter, 1 trade per ticker per day, target 1:2, BE at 1x

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

function getStop(p){return p<100?0.5:p<250?1:p<400?1.5:p<550?2:2.5;}
function calcEMA(a,p){if(!a||a.length<p)return[];const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}

function simulateTrade(dir, entry, sd, data, si, ei) {
  const tgt=dir==='CALL'?entry+sd*2:entry-sd*2;
  let stop=dir==='CALL'?entry-sd:entry+sd, be=false;
  for(let j=si+1;j<=ei;j++){
    const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){if(h>=entry+sd&&!be){stop=entry;be=true;}if(l<=stop)return{pnl:stop-entry,type:be?'BE':'STOP'};if(h>=tgt)return{pnl:tgt-entry,type:'TARGET'};}
    else{if(entry-l>=sd&&!be){stop=entry;be=true;}if(h>=stop)return{pnl:entry-stop,type:be?'BE':'STOP'};if(l<=tgt)return{pnl:entry-tgt,type:'TARGET'};}
  }
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD'};}

async function run(){
  console.log('Loading SPY for convergence...');
  const spyData = await fetchChart('SPY','5m','10d');

  const allTrades = [];

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);
    const [data5m, dailyData] = await Promise.all([
      fetchChart(ticker,'5m','10d'),
      fetchChart(ticker,'1d','3mo'),
    ]);
    if (!data5m || data5m.timestamps.length<100) { console.log('skip'); continue; }

    const days = groupByDay(data5m.timestamps);
    const spyDays = groupByDay(spyData.timestamps);
    const dayKeys = Object.keys(days).sort().slice(-8);
    const ema10 = calcEMA(data5m.closes, 10);
    const ema20 = calcEMA(data5m.closes, 20);
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[];
    const dTs=dailyData?dailyData.timestamps:[];const dEma10=calcEMA(dCloses,10);

    function getDayTrend(dk){if(dCloses.length<12)return'NEUTRAL';const ts=new Date(dk+'T12:00:00').getTime()/1000;let idx=-1;for(let i=dTs.length-1;i>=0;i--){if(dTs[i]<=ts+86400){idx=i;break;}}if(idx<10)return'NEUTRAL';const t10=((dCloses[idx]-dCloses[idx-10])/dCloses[idx-10])*100;const t5=((dCloses[idx]-dCloses[idx-5])/dCloses[idx-5])*100;if(t10>0.5&&t5>0)return'UP';if(t10<-0.5&&t5<0)return'DOWN';return'NEUTRAL';}

    let tc=0;
    for (const dk of dayKeys) {
      const indices = days[dk];
      if (!indices || indices.length < 30) continue;
      const dt = getDayTrend(dk);

      // VWAP for today
      let vN=0,vD=0; const vwaps=[];
      for (const ci of indices) {
        if(data5m.highs[ci]!=null&&data5m.lows[ci]!=null&&data5m.closes[ci]!=null&&data5m.volumes[ci]!=null){
          vN+=((data5m.highs[ci]+data5m.lows[ci]+data5m.closes[ci])/3)*data5m.volumes[ci];vD+=data5m.volumes[ci];}
        vwaps.push(vD?vN/vD:null);
      }

      // SPY data for this day
      const spyIdx = spyDays[dk] || [];
      const spyOpen = spyIdx.length ? spyData.closes[spyIdx[0]] : null;

      const regIdx = indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=585&&m<955;});
      let traded = false;

      for (let ri=10; ri<regIdx.length-3; ri++) {
        if (traded) break;
        const ci = regIdx[ri];
        const price = data5m.closes[ci];
        if (!price || !ema10[ci] || !ema20[ci]) continue;

        // Skip lunch (12:00-12:30)
        const mins = getMinutesET(data5m.timestamps[ci]);
        if (mins >= 720 && mins < 750) continue;

        const e10 = ema10[ci], e20 = ema20[ci];
        const e10slope = ci>=3 ? ema10[ci]-ema10[ci-3] : 0;
        const vwapIdx = indices.indexOf(ci);
        const vwap = vwapIdx>=0 ? vwaps[vwapIdx] : null;

        // Volume
        const volSlice=data5m.volumes.slice(Math.max(0,ci-20),ci+1).filter(v=>v!=null&&v>0);
        const avgVol=volSlice.length?volSlice.reduce((a,b)=>a+b,0)/volSlice.length:1;
        const highVol=(data5m.volumes[ci]||0)>avgVol*1.5;

        // SPY convergence
        const spyCi = spyIdx.find(si => spyData.timestamps[si] <= data5m.timestamps[ci] && spyData.timestamps[si] > data5m.timestamps[ci]-400);
        const spyNow = spyCi!=null ? spyData.closes[spyCi] : null;
        const spyPct = spyOpen&&spyNow ? ((spyNow-spyOpen)/spyOpen)*100 : 0;
        const spy3 = spyCi!=null&&spyCi>=3 ? spyData.closes[spyCi]-spyData.closes[spyCi-3] : 0;

        // Previous candle
        const prev1=data5m.closes[ci-1], prevOpen1=data5m.opens[ci-1];

        // Chop
        const rangeH=Math.max(...data5m.highs.slice(Math.max(0,ci-30),ci+1).filter(v=>v!=null));
        const rangeL=Math.min(...data5m.lows.slice(Math.max(0,ci-30),ci+1).filter(v=>v!=null));
        const rangePct=((rangeH-rangeL)/price)*100;
        let hT=0,lT=0;
        for(let j=Math.max(0,ci-30);j<=ci;j++){if(data5m.highs[j]>=rangeH*0.998)hT++;if(data5m.lows[j]<=rangeL*1.002)lT++;}
        if(hT>=3&&lT>=3&&rangePct<1.5) continue; // skip chop

        // Sweep
        const sweepLow=data5m.lows[ci]<rangeL*1.001&&data5m.closes[ci]>rangeL&&(data5m.closes[ci]-data5m.lows[ci])>Math.abs(data5m.closes[ci]-data5m.opens[ci])*1.5;
        const sweepHigh=data5m.highs[ci]>rangeH*0.999&&data5m.closes[ci]<rangeH&&(data5m.highs[ci]-data5m.closes[ci])>Math.abs(data5m.closes[ci]-data5m.opens[ci])*1.5;

        // VWAP reclaim
        const wasBelowVwap=vwap&&ci>=3&&data5m.closes[ci-3]<vwap&&data5m.closes[ci-2]<vwap;
        const vwapReclaim=wasBelowVwap&&price>vwap;

        // === SCORE ===
        let callScore=0, putScore=0;
        const callR=[], putR=[];

        if(price>e10&&e10slope>0.05){callScore+=2;callR.push('EMA10↑');}
        if(e10>e20){callScore+=1;callR.push('E10>E20');}
        if(vwap&&price>vwap){callScore+=2;callR.push('VWAP↑');}
        if(vwapReclaim){callScore+=3;callR.push('VWAPrecl');}
        if(spyPct>0.1&&spy3>0){callScore+=2;callR.push('SPY↑');}
        if(highVol){callScore+=1;callR.push('Vol');}
        if(sweepLow){callScore+=2;callR.push('Sweep↓');}
        if(prev1<prevOpen1&&data5m.closes[ci]>data5m.opens[ci]){callScore+=1;callR.push('Bounce');}

        if(price<e10&&e10slope<-0.05){putScore+=2;putR.push('EMA10↓');}
        if(e10<e20){putScore+=1;putR.push('E10<E20');}
        if(vwap&&price<vwap){putScore+=2;putR.push('VWAP↓');}
        if(spyPct<-0.1&&spy3<0){putScore+=2;putR.push('SPY↓');}
        if(highVol){putScore+=1;putR.push('Vol');}
        if(sweepHigh){putScore+=2;putR.push('Sweep↑');}
        if(prev1>prevOpen1&&data5m.closes[ci]<data5m.opens[ci]){putScore+=1;putR.push('Reject');}

        let dir=null, score=0, reasons=[];
        if(callScore>=5&&callScore>putScore){dir='CALL';score=callScore;reasons=callR;}
        else if(putScore>=5&&putScore>callScore){dir='PUT';score=putScore;reasons=putR;}
        if(!dir) continue;

        // Trend filter
        if(dir==='CALL'&&dt==='DOWN') continue;
        if(dir==='PUT'&&dt==='UP') continue;

        const sd = getStop(price);
        const eod = regIdx[regIdx.length-1];
        const res = simulateTrade(dir, price, sd, data5m, ci, eod);
        const time = new Date(data5m.timestamps[ci]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});
        const setup = score>=8?'A+':score>=6?'A':'B';

        allTrades.push({
          date:dk, time, ticker, dir, score, setup,
          entry:+price.toFixed(2),
          sl:+(dir==='CALL'?price-sd:price+sd).toFixed(2),
          tp:+(dir==='CALL'?price+sd*2:price-sd*2).toFixed(2),
          pnl:+res.pnl.toFixed(2), exitType:res.type,
          result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
          reasons:reasons.join('+'), dayTrend:dt,
        });
        traded = true; tc++;
      }
    }
    console.log(`${tc} trades`);
    await new Promise(r=>setTimeout(r,200));
  }

  allTrades.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));

  const MULT = 0.50*2*100/2;
  console.log('\n'+'='.repeat(130));
  console.log('/LIVE STRATEGY — Últimos 7 días | Target 1:2 | BE 1x | Max 1/ticker/día | Score min 5');
  console.log('='.repeat(130));

  let currentDay='';
  console.log(`\n${'Fecha'.padEnd(11)} ${'Hora'.padEnd(9)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Sc'.padEnd(3)} ${'Grd'.padEnd(3)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP'.padEnd(9)} ${'PnL'.padEnd(8)} ${'$2c'.padEnd(7)} ${'Res'.padEnd(6)} ${'Trend'.padEnd(7)} Razones`);
  console.log('-'.repeat(130));

  for(const t of allTrades){
    if(t.date!==currentDay&&currentDay){
      const dTrades=allTrades.filter(x=>x.date===currentDay);
      const dp=dTrades.reduce((s,x)=>s+x.pnl,0)*MULT;
      console.log(`${''.padEnd(75)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)}`);
      console.log('');
    }
    currentDay=t.date;
    const cp=t.pnl*MULT;
    const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
    console.log(`${t.date.padEnd(11)} ${t.time.padEnd(9)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} ${String(t.score).padEnd(3)} ${t.setup.padEnd(3)} $${String(t.entry).padEnd(8)} $${String(t.sl).padEnd(8)} $${String(t.tp).padEnd(8)} ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${(cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(4)} ${icon}${t.result.padEnd(5)} ${t.dayTrend.padEnd(7)} ${t.reasons}`);
  }
  // Last day
  {const dTrades=allTrades.filter(x=>x.date===currentDay);const dp=dTrades.reduce((s,x)=>s+x.pnl,0)*MULT;
  console.log(`${''.padEnd(75)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)}`);}

  // Summary
  const w=allTrades.filter(t=>t.result==='WIN').length;
  const l=allTrades.filter(t=>t.result==='LOSS').length;
  const b=allTrades.filter(t=>t.result==='BE').length;
  const pnl=allTrades.reduce((s,t)=>s+t.pnl,0);
  const cpnl=pnl*MULT;
  const gw=allTrades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const gl=Math.abs(allTrades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
  const days=new Set(allTrades.map(t=>t.date)).size;

  console.log('\n'+'='.repeat(130));
  console.log(`TOTAL: ${allTrades.length} trades en ${days} días | ${w}W ${l}L ${b}BE | WR ${((w/allTrades.length)*100).toFixed(0)}% | PF ${gl>0?(gw/gl).toFixed(2):'∞'}`);
  console.log(`Stock PnL: $${pnl.toFixed(2)} | 2 contratos: $${cpnl.toFixed(0)} | Promedio: $${(cpnl/days).toFixed(0)}/día`);
}

run().catch(console.error);
