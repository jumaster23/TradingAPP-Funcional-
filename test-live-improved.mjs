// /LIVE improved: Same EMA+VWAP scoring, but SPY+VIX convergence + target 1:2
// Compare: original (NQ+SPX, 1:3) vs improved (SPY+VIX, 1:2)

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

function simulateTrade(dir,entry,sd,targetMult,data,si,ei){
  const tgt=dir==='CALL'?entry+sd*targetMult:entry-sd*targetMult;
  let stop=dir==='CALL'?entry-sd:entry+sd,be=false;
  for(let j=si+1;j<=ei;j++){const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){if(h>=entry+sd&&!be){stop=entry;be=true;}if(l<=stop)return{pnl:stop-entry,type:be?'BE':'STOP'};if(h>=tgt)return{pnl:tgt-entry,type:'TARGET'};}
    else{if(entry-l>=sd&&!be){stop=entry;be=true;}if(h>=stop)return{pnl:entry-stop,type:be?'BE':'STOP'};if(l<=tgt)return{pnl:entry-tgt,type:'TARGET'};}
  }
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD'};}

async function run(){
  console.log('Loading convergence data...');
  const [spy1m, vix1m] = await Promise.all([fetch1minWeek('SPY'), fetch1minWeek('^VIX')]);

  const variants = {
    'SPY+VIX 1:2 score≥5': { conv: 'spyvix', target: 2, minScore: 5, results: [] },
    'SPY+VIX 1:2 score≥6': { conv: 'spyvix', target: 2, minScore: 6, results: [] },
    'SPY+VIX 1:2 score≥7': { conv: 'spyvix', target: 2, minScore: 7, results: [] },
    'SPY+VIX 1:3 score≥5': { conv: 'spyvix', target: 3, minScore: 5, results: [] },
    'SPY+VIX 1:2 score≥5 no lunch': { conv: 'spyvix', target: 2, minScore: 5, noLunch: true, results: [] },
    'Solo convergencia (sin score)': { conv: 'spyvix', target: 2, minScore: 0, results: [] },
  };

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);
    const [data5m, spyData, dailyData] = await Promise.all([
      fetchChart(ticker,'5m','10d'),
      fetchChart('SPY','5m','10d'),
      fetchChart(ticker,'1d','3mo'),
    ]);
    if (!data5m || !spyData || data5m.timestamps.length<100) { console.log('skip'); continue; }

    const days=groupByDay(data5m.timestamps);const dayKeys=Object.keys(days).sort().slice(-8);
    const ema10=calcEMA(data5m.closes,10);const ema20=calcEMA(data5m.closes,20);
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[];const dTs=dailyData?dailyData.timestamps:[];const dEma10=calcEMA(dCloses,10);
    const spyDays=groupByDay(spyData.timestamps);

    function getDayTrend(dk){if(dCloses.length<12)return'NEUTRAL';const ts=new Date(dk+'T12:00:00').getTime()/1000;let idx=-1;for(let i=dTs.length-1;i>=0;i--){if(dTs[i]<=ts+86400){idx=i;break;}}if(idx<10)return'NEUTRAL';const t10=((dCloses[idx]-dCloses[idx-10])/dCloses[idx-10])*100;const t5=((dCloses[idx]-dCloses[idx-5])/dCloses[idx-5])*100;if(t10>0.5&&t5>0)return'UP';if(t10<-0.5&&t5<0)return'DOWN';return'NEUTRAL';}

    let tc=0;
    for(const dk of dayKeys){
      const indices=days[dk];if(!indices||indices.length<30)continue;
      const dt=getDayTrend(dk);

      // VWAP
      let vN=0,vD=0;const vwaps=[];
      for(const ci of indices){if(data5m.highs[ci]!=null&&data5m.lows[ci]!=null&&data5m.closes[ci]!=null&&data5m.volumes[ci]!=null){vN+=((data5m.highs[ci]+data5m.lows[ci]+data5m.closes[ci])/3)*data5m.volumes[ci];vD+=data5m.volumes[ci];}vwaps.push(vD?vN/vD:null);}

      const spyIdx=spyDays[dk]||[];const spyOpen=spyIdx.length?spyData.closes[spyIdx[0]]:null;
      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=585&&m<955;});

      // Per-variant state
      const state={};for(const k of Object.keys(variants))state[k]={traded:false};

      for(let ri=10;ri<regIdx.length-3;ri++){
        const ci=regIdx[ri];const price=data5m.closes[ci];
        if(!price||!ema10[ci]||!ema20[ci])continue;
        const mins=getMinutesET(data5m.timestamps[ci]);
        const cts=data5m.timestamps[ci];
        const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        const e10=ema10[ci],e20=ema20[ci];
        const e10slope=ci>=3?ema10[ci]-ema10[ci-3]:0;
        const vwapIdx=indices.indexOf(ci);const vwap=vwapIdx>=0?vwaps[vwapIdx]:null;

        // Volume
        const volSlice=data5m.volumes.slice(Math.max(0,ci-20),ci+1).filter(v=>v!=null&&v>0);
        const avgVol=volSlice.length?volSlice.reduce((a,b)=>a+b,0)/volSlice.length:1;
        const highVol=(data5m.volumes[ci]||0)>avgVol*1.5;

        // SPY
        const spyCi=spyIdx.find(si=>spyData.timestamps[si]<=cts&&spyData.timestamps[si]>cts-400);
        const spyNow=spyCi!=null?spyData.closes[spyCi]:null;
        const spyPct=spyOpen&&spyNow?((spyNow-spyOpen)/spyOpen)*100:0;
        const spy3=spyCi!=null&&spyCi>=3?spyData.closes[spyCi]-spyData.closes[spyCi-3]:0;

        const prev1=data5m.closes[ci-1],prevOpen1=data5m.opens[ci-1];

        // Chop
        const rangeH=Math.max(...data5m.highs.slice(Math.max(0,ci-30),ci+1).filter(v=>v!=null));
        const rangeL=Math.min(...data5m.lows.slice(Math.max(0,ci-30),ci+1).filter(v=>v!=null));
        const rangePct=((rangeH-rangeL)/price)*100;
        let hT=0,lT=0;for(let j=Math.max(0,ci-30);j<=ci;j++){if(data5m.highs[j]>=rangeH*0.998)hT++;if(data5m.lows[j]<=rangeL*1.002)lT++;}
        if(hT>=3&&lT>=3&&rangePct<1.5)continue;

        // Sweep
        const sweepLow=data5m.lows[ci]<rangeL*1.001&&data5m.closes[ci]>rangeL&&(data5m.closes[ci]-data5m.lows[ci])>Math.abs(data5m.closes[ci]-data5m.opens[ci])*1.5;
        const sweepHigh=data5m.highs[ci]>rangeH*0.999&&data5m.closes[ci]<rangeH&&(data5m.highs[ci]-data5m.closes[ci])>Math.abs(data5m.closes[ci]-data5m.opens[ci])*1.5;

        // VWAP reclaim
        const wasBelowVwap=vwap&&ci>=3&&data5m.closes[ci-3]<vwap&&data5m.closes[ci-2]<vwap;
        const vwapReclaim=wasBelowVwap&&price>vwap;

        // Score
        let callScore=0,putScore=0;const callR=[],putR=[];
        if(price>e10&&e10slope>0.05){callScore+=2;callR.push('EMA10↑');}
        if(e10>e20){callScore+=1;callR.push('E10>20');}
        if(vwap&&price>vwap){callScore+=2;callR.push('VWAP↑');}
        if(vwapReclaim){callScore+=3;callR.push('VWAPrecl');}
        if(spyPct>0.1&&spy3>0){callScore+=2;callR.push('SPY↑');}
        if(highVol){callScore+=1;callR.push('Vol');}
        if(sweepLow){callScore+=2;callR.push('Sweep');}
        if(prev1<prevOpen1&&data5m.closes[ci]>data5m.opens[ci]){callScore+=1;callR.push('Bounce');}

        if(price<e10&&e10slope<-0.05){putScore+=2;putR.push('EMA10↓');}
        if(e10<e20){putScore+=1;putR.push('E10<20');}
        if(vwap&&price<vwap){putScore+=2;putR.push('VWAP↓');}
        if(spyPct<-0.1&&spy3<0){putScore+=2;putR.push('SPY↓');}
        if(highVol){putScore+=1;putR.push('Vol');}
        if(sweepHigh){putScore+=2;putR.push('Sweep');}
        if(prev1>prevOpen1&&data5m.closes[ci]<data5m.opens[ci]){putScore+=1;putR.push('Reject');}

        // Trend filter
        if(dt==='DOWN')callScore=0;
        if(dt==='UP')putScore=0;

        const sd=getStop(price);
        const eod=regIdx[regIdx.length-1];

        for(const [vName, v] of Object.entries(variants)){
          if(state[vName].traded)continue;

          let dir=null,score=0,reasons=[];
          if(callScore>=v.minScore&&callScore>putScore){dir='CALL';score=callScore;reasons=callR;}
          else if(putScore>=v.minScore&&putScore>callScore){dir='PUT';score=putScore;reasons=putR;}
          if(!dir)continue;

          // Lunch filter
          if(v.noLunch&&mins>=720&&mins<780)continue;

          // SPY+VIX convergence
          if(!checkIdx(spy1m,cts,dir,false))continue;
          if(!checkIdx(vix1m,cts,dir,true))continue;

          state[vName].traded=true;
          const res=simulateTrade(dir,price,sd,v.target,data5m,ci,eod);

          v.results.push({
            date:dk,time,ticker,dir,score,
            entry:+price.toFixed(2),pnl:+res.pnl.toFixed(2),exitType:res.type,
            result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
            reasons:reasons.join('+'),dayTrend:dt,
          });
          if(vName.includes('score≥5')&&v.target===2&&!v.noLunch)tc++;
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  const MULT=0.50*2*100/2;

  console.log('\n'+'='.repeat(110));
  console.log('/LIVE MEJORADO — Comparación de variantes (últimos 7-8 días)');
  console.log('Todas usan: EMA+VWAP scoring + SPY+VIX convergencia + tendencia + max 1/ticker/día');
  console.log('='.repeat(110));

  for(const [name,v] of Object.entries(variants)){
    const trades=v.results;
    const w=trades.filter(t=>t.result==='WIN').length;
    const l=trades.filter(t=>t.result==='LOSS').length;
    const b=trades.filter(t=>t.result==='BE').length;
    const pnl=trades.reduce((s,t)=>s+t.pnl,0);
    const cpnl=pnl*MULT;
    const gw=trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gl=Math.abs(trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    const days=new Set(trades.map(t=>t.date)).size;
    const pf=gl>0?(gw/gl).toFixed(2):'∞';
    const wr=trades.length?((w/trades.length)*100).toFixed(0):'0';

    console.log(`\n${name}`);
    console.log(`  ${trades.length} trades (${days}d, ${(trades.length/days).toFixed(1)}/d) | ${w}W ${l}L ${b}BE | WR ${wr}% | PF ${pf} | $${cpnl.toFixed(0)} ($${(cpnl/days).toFixed(0)}/d)`);
  }

  // Show trades for best variant (score≥7)
  const best = variants['SPY+VIX 1:2 score≥7'];
  console.log('\n\n'+'='.repeat(120));
  console.log('DETALLE: SPY+VIX 1:2 score≥7 (más selectivo)');
  console.log('='.repeat(120));

  let currentDay='';
  for(const t of best.results){
    if(t.date!==currentDay&&currentDay){
      const dt=best.results.filter(x=>x.date===currentDay);
      const dp=dt.reduce((s,x)=>s+x.pnl,0)*MULT;
      console.log(`${''.padEnd(80)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)}`);console.log('');
    }
    currentDay=t.date;
    const cp=t.pnl*MULT;
    const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
    console.log(`${t.date.padEnd(11)} ${t.time.padEnd(9)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} sc${String(t.score).padEnd(3)} $${String(t.entry).padEnd(8)} ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${(cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(5)} ${icon}${t.result.padEnd(5)} ${t.dayTrend.padEnd(7)} ${t.reasons}`);
  }
  {const dt=best.results.filter(x=>x.date===currentDay);const dp=dt.reduce((s,x)=>s+x.pnl,0)*MULT;
  console.log(`${''.padEnd(80)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)}`);}

  // Also show score≥5 trades for today
  const today=new Date().toISOString().slice(0,10);
  const s5=variants['SPY+VIX 1:2 score≥5'];
  const todayTrades=s5.results.filter(t=>t.date===today);
  if(todayTrades.length){
    console.log(`\n--- HOY (${today}) score≥5 ---`);
    for(const t of todayTrades){
      const cp=t.pnl*MULT;const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
      console.log(`  ${t.time} ${t.ticker.padEnd(5)} ${t.dir.padEnd(4)} sc${t.score} $${t.entry} → ${icon}${t.result} $${t.pnl.toFixed(2)} (${(cp>=0?'+':'')+'$'+cp.toFixed(0)}) ${t.reasons}`);
    }
  }
}

run().catch(console.error);
