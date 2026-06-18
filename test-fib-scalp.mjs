// FIBONACCI SCALPING: Retrace to fib levels from 15/30min candle ranges
// Target: $1-2 moves. Tight stops. High win rate.

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

function calcEMA(a,p){if(!a||a.length<p)return[];const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}

// Fibonacci levels from a swing high/low
function fibLevels(high, low) {
  const range = high - low;
  return {
    high, low, range,
    fib236: high - range * 0.236,
    fib382: high - range * 0.382,
    fib500: high - range * 0.500,
    fib618: high - range * 0.618,
    fib786: high - range * 0.786,
  };
}

function simulateScalp(dir, entry, stopDist, targetDist, data, si, ei) {
  const tgt = dir==='CALL' ? entry+targetDist : entry-targetDist;
  const stop = dir==='CALL' ? entry-stopDist : entry+stopDist;
  let maxFav=0;
  for(let j=si+1;j<=ei;j++){
    const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){
      maxFav=Math.max(maxFav,h-entry);
      if(l<=stop)return{pnl:stop-entry,type:'STOP',maxFav};
      if(h>=tgt)return{pnl:tgt-entry,type:'TARGET',maxFav};
    }else{
      maxFav=Math.max(maxFav,entry-l);
      if(h>=stop)return{pnl:entry-stop,type:'STOP',maxFav};
      if(l<=tgt)return{pnl:entry-tgt,type:'TARGET',maxFav};
    }
  }
  const ep=data.closes[ei]||entry;
  return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD',maxFav};
}

async function run(){
  const allTrades={};
  const configs = [
    // { label, tf, stopMult, targetMult, fibLevel, maxPerDay }
    // tf = timeframe of candles to find swing H/L (in 5min candles: 3=15min, 6=30min)
    {label:'15min fib50 SL=0.5 TP=1.0', lookback:3, fibKey:'fib500', sl:0.5, tp:1.0, maxDay:5},
    {label:'15min fib50 SL=0.5 TP=1.5', lookback:3, fibKey:'fib500', sl:0.5, tp:1.5, maxDay:5},
    {label:'15min fib382 SL=0.5 TP=1.0', lookback:3, fibKey:'fib382', sl:0.5, tp:1.0, maxDay:5},
    {label:'15min fib618 SL=0.5 TP=1.0', lookback:3, fibKey:'fib618', sl:0.5, tp:1.0, maxDay:5},
    {label:'30min fib50 SL=0.5 TP=1.0', lookback:6, fibKey:'fib500', sl:0.5, tp:1.0, maxDay:5},
    {label:'30min fib50 SL=0.75 TP=1.5', lookback:6, fibKey:'fib500', sl:0.75, tp:1.5, maxDay:5},
    {label:'30min fib382 SL=0.5 TP=1.5', lookback:6, fibKey:'fib382', sl:0.5, tp:1.5, maxDay:5},
    {label:'30min fib618 SL=0.5 TP=1.5', lookback:6, fibKey:'fib618', sl:0.5, tp:1.5, maxDay:5},
    {label:'30min fib50 SL=0.5 TP=2.0', lookback:6, fibKey:'fib500', sl:0.5, tp:2.0, maxDay:5},
    {label:'15min fib50 SL=1.0 TP=2.0', lookback:3, fibKey:'fib500', sl:1.0, tp:2.0, maxDay:3},
    {label:'30min fib382 SL=1.0 TP=2.0', lookback:6, fibKey:'fib382', sl:1.0, tp:2.0, maxDay:3},
    // Adaptive stops
    {label:'15min fib50 adaptive SL TP=2x', lookback:3, fibKey:'fib500', sl:'adaptive', tp:'2x', maxDay:5},
    {label:'30min fib50 adaptive SL TP=2x', lookback:6, fibKey:'fib500', sl:'adaptive', tp:'2x', maxDay:5},
  ];

  for(const cfg of configs) allTrades[cfg.label]=[];

  for(const ticker of TICKERS){
    process.stdout.write(`${ticker}... `);
    const [data5m, dailyData] = await Promise.all([
      fetchChart(ticker,'5m','1mo'),
      fetchChart(ticker,'1d','3mo'),
    ]);
    if(!data5m||data5m.timestamps.length<100){console.log('skip');continue;}

    const days=groupByDay(data5m.timestamps);const dayKeys=Object.keys(days).sort();
    const ema10=calcEMA(data5m.closes,10);const ema20=calcEMA(data5m.closes,20);
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[];const dTs=dailyData?dailyData.timestamps:[];const dEma10=calcEMA(dCloses,10);

    function getDayTrend(dk){if(dCloses.length<12)return'NEUTRAL';const ts=new Date(dk+'T12:00:00').getTime()/1000;let idx=-1;for(let i=dTs.length-1;i>=0;i--){if(dTs[i]<=ts+86400){idx=i;break;}}if(idx<10)return'NEUTRAL';if(dCloses[idx]>dEma10[idx]&&dCloses[idx-1]>dCloses[idx-2])return'UP';if(dCloses[idx]<dEma10[idx]&&dCloses[idx-1]<dCloses[idx-2])return'DOWN';return'NEUTRAL';}

    let tc=0;
    for(const dk of dayKeys){
      const indices=days[dk];if(!indices||indices.length<30)continue;
      const dt=getDayTrend(dk);
      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=585&&m<955;});
      if(regIdx.length<15)continue;

      // VWAP
      let vN=0,vD=0;const vwaps=[];
      for(const ci of indices){if(data5m.highs[ci]!=null&&data5m.lows[ci]!=null&&data5m.closes[ci]!=null&&data5m.volumes[ci]!=null){vN+=((data5m.highs[ci]+data5m.lows[ci]+data5m.closes[ci])/3)*data5m.volumes[ci];vD+=data5m.volumes[ci];}vwaps.push(vD?vN/vD:null);}

      for(const cfg of configs){
        let dayTrades=0;

        for(let ri=cfg.lookback+2;ri<regIdx.length-2;ri++){
          if(dayTrades>=cfg.maxDay)break;
          const ci=regIdx[ri];
          const price=data5m.closes[ci];
          if(!price)continue;
          const cts=data5m.timestamps[ci];
          const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

          // Find swing H/L from last N candles (lookback)
          const lookbackStart=ri-cfg.lookback;
          let swH=-Infinity,swL=Infinity;
          for(let j=lookbackStart;j<ri;j++){
            const jci=regIdx[j];
            if(data5m.highs[jci]!=null&&data5m.highs[jci]>swH)swH=data5m.highs[jci];
            if(data5m.lows[jci]!=null&&data5m.lows[jci]<swL)swL=data5m.lows[jci];
          }
          const range=swH-swL;
          if(range<0.20||range>20)continue; // skip tiny or huge ranges

          const fibs=fibLevels(swH,swL);
          const fibLevel=fibs[cfg.fibKey];
          if(!fibLevel)continue;

          // EMA trend
          const e10=ema10[ci],e20=ema20[ci];
          if(!e10||!e20)continue;

          // Determine direction from EMA + price position relative to fib
          let dir=null;

          // CALL: price pulls back DOWN to fib level from above (bullish retrace)
          // Price was above fib, dipped to it, and we enter expecting bounce up
          if(price<=fibLevel*1.001&&price>=fibLevel*0.998){
            // Price is AT the fib level
            const prevPrice=data5m.closes[regIdx[ri-1]];
            if(prevPrice>fibLevel&&price<=fibLevel){
              // Came from above → pullback → CALL if trend is up
              if(e10>e20&&dt!=='DOWN')dir='CALL';
            }
            if(prevPrice<fibLevel&&price>=fibLevel){
              // Came from below → rally → PUT if trend is down
              if(e10<e20&&dt!=='UP')dir='PUT';
            }
          }

          // Also: bounce off fib level
          const lo=data5m.lows[ci],hi=data5m.highs[ci],cl=data5m.closes[ci],op=data5m.opens[ci];
          if(!dir&&lo!=null&&lo<=fibLevel*1.002&&cl>fibLevel&&cl>op){
            // Wick touched fib, closed above → bounce CALL
            if(e10>e20&&dt!=='DOWN')dir='CALL';
          }
          if(!dir&&hi!=null&&hi>=fibLevel*0.998&&cl<fibLevel&&cl<op){
            // Wick touched fib from below, closed under → rejection PUT
            if(e10<e20&&dt!=='UP')dir='PUT';
          }

          if(!dir)continue;

          // Calculate SL/TP
          let sl,tp;
          if(cfg.sl==='adaptive'){
            // Adaptive: SL = distance to opposite fib level, min $0.30
            if(dir==='CALL'){
              sl=Math.max(0.30, price-fibs.fib618);
              if(sl>2.0)sl=1.0; // cap
            }else{
              sl=Math.max(0.30, fibs.fib382-price);
              if(sl>2.0)sl=1.0;
            }
            tp=sl*2;
          }else{
            sl=cfg.sl;
            tp=cfg.tp;
          }

          // Skip if stop is too big relative to price
          if(sl/price>0.015)continue; // max 1.5% risk

          const eod=regIdx[regIdx.length-1];
          // Limit trade to next 12 candles (1 hour) for scalp
          const maxExit=Math.min(eod,regIdx[Math.min(ri+12,regIdx.length-1)]);
          const res=simulateScalp(dir,price,sl,tp,data5m,ci,maxExit);

          allTrades[cfg.label].push({
            date:dk,time,ticker,dir,
            entry:+price.toFixed(2),sl:+sl.toFixed(2),tp:+tp.toFixed(2),
            fibLevel:+fibLevel.toFixed(2),swH:+swH.toFixed(2),swL:+swL.toFixed(2),range:+range.toFixed(2),
            pnl:+res.pnl.toFixed(2),exitType:res.type,
            result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
            maxFav:+res.maxFav.toFixed(2),dayTrend:dt,
          });
          dayTrades++;
          tc++;
          ri+=2; // skip 2 candles after entry (avoid re-entry immediately)
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  const MULT=0.50*2*100/2;

  console.log('\n'+'='.repeat(120));
  console.log('FIBONACCI SCALP — Comparación de configuraciones');
  console.log('Retrace a fib level de 15/30min swings + EMA trend + daily trend');
  console.log('='.repeat(120));

  const sorted=Object.entries(allTrades)
    .map(([label,trades])=>{
      const w=trades.filter(t=>t.result==='WIN').length;
      const l=trades.filter(t=>t.result==='LOSS').length;
      const pnl=trades.reduce((s,t)=>s+t.pnl,0);
      const gw=trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
      const gl=Math.abs(trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
      const days=new Set(trades.map(t=>t.date)).size;
      return{label,trades,w,l,pnl,pf:gl>0?gw/gl:gw>0?999:0,days,cpnl:pnl*MULT};
    })
    .sort((a,b)=>b.cpnl-a.cpnl);

  for(const s of sorted){
    const wr=s.trades.length?((s.w/s.trades.length)*100).toFixed(0):'0';
    const tpd=s.days?(s.trades.length/s.days).toFixed(1):'0';
    console.log(`\n${s.label}`);
    console.log(`  ${s.trades.length} trades (${tpd}/d) | ${s.w}W ${s.l}L | WR ${wr}% | PF ${s.pf.toFixed(2)} | $${s.cpnl.toFixed(0)} (${s.days}d → $${(s.cpnl/s.days).toFixed(0)}/d)`);
  }

  // Show trades for top config
  const best=sorted[0];
  if(best&&best.trades.length>0){
    console.log('\n\n'+'='.repeat(120));
    console.log(`MEJOR CONFIG: ${best.label}`);
    console.log('='.repeat(120));

    const byDay={};
    best.trades.forEach(t=>{if(!byDay[t.date])byDay[t.date]=[];byDay[t.date].push(t);});

    for(const [day,trades] of Object.entries(byDay).sort()){
      const dp=trades.reduce((s,t)=>s+t.pnl,0)*MULT;
      const dw=trades.filter(t=>t.result==='WIN').length;
      const dl=trades.filter(t=>t.result==='LOSS').length;
      console.log(`\n${day} — ${trades.length} trades (${dw}W ${dl}L) → ${dp>=0?'+':''}$${dp.toFixed(0)}`);
      for(const t of trades){
        const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
        console.log(`  ${t.time} ${t.ticker.padEnd(5)} ${t.dir.padEnd(4)} @$${t.entry} fib$${t.fibLevel} [${t.swL}-${t.swH}] SL$${t.sl} TP$${t.tp} → ${icon}${t.result} $${t.pnl.toFixed(2)} maxFav$${t.maxFav.toFixed(2)} ${t.dayTrend}`);
      }
    }
  }
}

run().catch(console.error);
