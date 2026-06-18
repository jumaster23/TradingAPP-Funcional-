// FINAL: PMH CALL only + daily trend + first-touch + target 1:2 + BE 1x
// The best strategy found

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

function simulateTrade(dir,entry,sd,data,si,ei){
  const tgt=entry+sd*2; // CALL only, target 2x
  let stop=entry-sd,be=false,maxFav=0;
  for(let j=si+1;j<=ei;j++){const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    maxFav=Math.max(maxFav,h-entry);
    if(h>=entry+sd&&!be){stop=entry;be=true;}
    if(l<=stop)return{pnl:stop-entry,type:be?'BE':'STOP',maxFav,exitIdx:j};
    if(h>=tgt)return{pnl:tgt-entry,type:'TARGET',maxFav,exitIdx:j};}
  const ep=data.closes[ei]||entry;return{pnl:ep-entry,type:'EOD',maxFav,exitIdx:ei};}

async function run(){
  const allTrades=[];

  for(const ticker of TICKERS){
    process.stdout.write(`${ticker}... `);
    const [data5m,dailyData]=await Promise.all([fetchChart(ticker,'5m','1mo'),fetchChart(ticker,'1d','3mo')]);
    if(!data5m||data5m.timestamps.length<100){console.log('skip');continue;}
    const days=groupByDay(data5m.timestamps);const dayKeys=Object.keys(days).sort();
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[];const dTs=dailyData?dailyData.timestamps:[];const dEma10=calcEMA(dCloses,10);
    function getDayTrend(dk){if(dCloses.length<12)return'NEUTRAL';const ts=new Date(dk+'T12:00:00').getTime()/1000;let idx=-1;for(let i=dTs.length-1;i>=0;i--){if(dTs[i]<=ts+86400){idx=i;break;}}if(idx<10)return'NEUTRAL';if(dCloses[idx]>dEma10[idx]&&dCloses[idx-1]>dCloses[idx-2])return'UP';if(dCloses[idx]<dEma10[idx]&&dCloses[idx-1]<dCloses[idx-2])return'DOWN';return'NEUTRAL';}

    let tc=0;
    for(let di=1;di<dayKeys.length;di++){
      const dk=dayKeys[di];const indices=days[dk];if(!indices||indices.length<20)continue;
      const dt=getDayTrend(dk);
      if(dt==='DOWN')continue; // Only CALL, skip DOWN days

      // PMH from premarket
      let pmh=-Infinity,pmc=0;
      for(const ci of indices){const m=getMinutesET(data5m.timestamps[ci]);if(m>=240&&m<570){if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];pmc++;}}
      if(pmc<3||pmh===-Infinity)continue;

      // PML for range calc
      let pml=Infinity;
      for(const ci of indices){const m=getMinutesET(data5m.timestamps[ci]);if(m>=240&&m<570){if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];}}
      const pmRange=pmh-pml;

      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<955;});
      if(regIdx.length<10)continue;

      let touched=false;
      for(let ri=1;ri<regIdx.length-3;ri++){
        if(touched)break;
        const ci=regIdx[ri],pci=regIdx[ri-1];
        const price=data5m.closes[ci],h=data5m.highs[ci];
        if(!price||!h)continue;
        const prevH=data5m.highs[pci];
        if(h>pmh&&prevH!=null&&prevH<=pmh){
          touched=true;tc++;
          const sd=getStop(price);
          const eod=regIdx[regIdx.length-1];
          const res=simulateTrade('CALL',price,sd,data5m,ci,eod);
          const time=new Date(data5m.timestamps[ci]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});
          const exitTime=new Date(data5m.timestamps[res.exitIdx]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

          allTrades.push({
            date:dk,time,exitTime,ticker,
            pmh:+pmh.toFixed(2),pmRange:+pmRange.toFixed(2),
            entry:+price.toFixed(2),
            sl:+(price-sd).toFixed(2),
            tp:+(price+sd*2).toFixed(2),
            be:+(price+sd).toFixed(2),
            exitPrice:+(price+res.pnl).toFixed(2),
            pnl:+res.pnl.toFixed(2),exitType:res.type,
            result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
            maxFav:+res.maxFav.toFixed(2),dayTrend:dt,sd,
          });
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  allTrades.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
  const MULT=0.50*2*100/2;

  console.log('\n'+'='.repeat(140));
  console.log('PMH CALL ONLY — Breakout del Premarket High + Tendencia UP/NEUTRAL + Target 1:2 + BE 1x');
  console.log('1 trade por ticker por día, first-touch only');
  console.log('='.repeat(140));

  console.log(`\n${'Fecha'.padEnd(11)} ${'Hora'.padEnd(9)} ${'Exit'.padEnd(9)} ${'Ticker'.padEnd(7)} ${'PMH'.padEnd(9)} ${'PMrng'.padEnd(7)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP(2x)'.padEnd(9)} ${'BE(1x)'.padEnd(9)} ${'ExitPr'.padEnd(9)} ${'PnL'.padEnd(8)} ${'$2c'.padEnd(7)} ${'Res'.padEnd(7)} ${'MaxFav'.padEnd(7)} Trend`);
  console.log('-'.repeat(140));

  let currentDay='',dayCount=0;
  for(const t of allTrades){
    if(t.date!==currentDay){
      if(currentDay){
        const dt=allTrades.filter(x=>x.date===currentDay);
        const dp=dt.reduce((s,x)=>s+x.pnl,0)*MULT;
        const dw=dt.filter(x=>x.result==='WIN').length;
        const dl=dt.filter(x=>x.result==='LOSS').length;
        const db=dt.filter(x=>x.result==='BE').length;
        console.log(`${''.padEnd(100)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)} (${dw}W ${dl}L ${db}BE)`);
        console.log('');
      }
      currentDay=t.date;dayCount++;
    }
    const cp=t.pnl*MULT;
    const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
    console.log(`${t.date.padEnd(11)} ${t.time.padEnd(9)} ${t.exitTime.padEnd(9)} ${t.ticker.padEnd(7)} $${String(t.pmh).padEnd(8)} $${t.pmRange.toFixed(1).padStart(5)} $${String(t.entry).padEnd(8)} $${String(t.sl).padEnd(8)} $${String(t.tp).padEnd(8)} $${String(t.be).padEnd(8)} $${String(t.exitPrice).padEnd(8)} ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${(cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(4)} ${icon} ${t.result.padEnd(5)} $${t.maxFav.toFixed(2).padStart(5)} ${t.dayTrend}`);
  }
  // Last day
  {const dt=allTrades.filter(x=>x.date===currentDay);const dp=dt.reduce((s,x)=>s+x.pnl,0)*MULT;const dw=dt.filter(x=>x.result==='WIN').length;const dl=dt.filter(x=>x.result==='LOSS').length;const db=dt.filter(x=>x.result==='BE').length;
  console.log(`${''.padEnd(100)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)} (${dw}W ${dl}L ${db}BE)`);}

  // Summary
  const w=allTrades.filter(t=>t.result==='WIN').length;
  const l=allTrades.filter(t=>t.result==='LOSS').length;
  const b=allTrades.filter(t=>t.result==='BE').length;
  const pnl=allTrades.reduce((s,t)=>s+t.pnl,0);
  const cpnl=pnl*MULT;
  const gw=allTrades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const gl=Math.abs(allTrades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
  const days=new Set(allTrades.map(t=>t.date)).size;
  const greenDays=Object.entries(
    allTrades.reduce((d,t)=>{d[t.date]=(d[t.date]||0)+t.pnl;return d;},{})
  ).filter(([,v])=>v>0).length;
  const redDays=Object.entries(
    allTrades.reduce((d,t)=>{d[t.date]=(d[t.date]||0)+t.pnl;return d;},{})
  ).filter(([,v])=>v<0).length;

  console.log('\n'+'='.repeat(140));
  console.log('RESUMEN FINAL');
  console.log('='.repeat(140));
  console.log(`Trades: ${allTrades.length} en ${days} días (${(allTrades.length/days).toFixed(1)}/día)`);
  console.log(`Wins: ${w} | Losses: ${l} | BE: ${b}`);
  console.log(`WR: ${((w/allTrades.length)*100).toFixed(0)}% | NLR: ${((1-l/allTrades.length)*100).toFixed(0)}%`);
  console.log(`PF: ${gl>0?(gw/gl).toFixed(2):'∞'}`);
  console.log(`Stock PnL: $${pnl.toFixed(2)} | 2 contratos: $${cpnl.toFixed(0)} | 4 contratos: $${(cpnl*2).toFixed(0)}`);
  console.log(`Promedio/día: $${(cpnl/days).toFixed(0)} (2c) | $${(cpnl*2/days).toFixed(0)} (4c)`);
  console.log(`Días verdes: ${greenDays}/${days} (${((greenDays/days)*100).toFixed(0)}%) | Días rojos: ${redDays}`);

  // Weekly
  console.log('\n--- POR SEMANA ---');
  const weeks={};
  allTrades.forEach(t=>{
    const d=new Date(t.date);
    const weekStart=new Date(d);weekStart.setDate(d.getDate()-d.getDay()+1);
    const wk=weekStart.toISOString().slice(5,10);
    if(!weeks[wk])weeks[wk]={trades:[],days:new Set()};
    weeks[wk].trades.push(t);weeks[wk].days.add(t.date);
  });
  for(const [wk,data] of Object.entries(weeks).sort()){
    const wp=data.trades.reduce((s,t)=>s+t.pnl,0)*MULT;
    const ww=data.trades.filter(t=>t.result==='WIN').length;
    const wl=data.trades.filter(t=>t.result==='LOSS').length;
    console.log(`  Semana ${wk}: ${data.trades.length} trades (${data.days.size}d) | ${ww}W ${wl}L → ${wp>=0?'+':''}$${wp.toFixed(0)}`);
  }
}

run().catch(console.error);
