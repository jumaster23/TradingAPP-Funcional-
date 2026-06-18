// ORB 5min CALL + SPX+VIX + filtro: PM range < $6 + ORB range > $0.80
// Test 1 mes, todos los tickers

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

function calcEMA(a,p){if(!a||a.length<p)return[];const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}

function check5m(data,ts,dir,inv){let idx=-1;for(let i=data.timestamps.length-1;i>=0;i--){if(data.timestamps[i]<=ts){idx=i;break;}}if(idx<3)return false;const c=data.closes;if(c[idx]==null||c[idx-3]==null)return false;const chg=c[idx]-c[idx-3];if(inv)return dir==='CALL'?chg<0:chg>0;return dir==='CALL'?chg>0:chg<0;}

function simulateTrade(dir,entry,sl,tp,data,si,ei){
  let maxFav=0;
  for(let j=si+1;j<=ei;j++){const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){maxFav=Math.max(maxFav,h-entry);if(l<=sl)return{pnl:sl-entry,type:'STOP',maxFav,exitIdx:j};if(h>=tp)return{pnl:tp-entry,type:'TARGET',maxFav,exitIdx:j};}
    else{maxFav=Math.max(maxFav,entry-l);if(h>=sl)return{pnl:entry-sl,type:'STOP',maxFav,exitIdx:j};if(l<=tp)return{pnl:entry-tp,type:'TARGET',maxFav,exitIdx:j};}}
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD',maxFav,exitIdx:ei};}

async function run(){
  console.log('Loading...');
  const [spxD,vixD]=await Promise.all([fetchChart('^GSPC','5m','1mo'),fetchChart('^VIX','5m','1mo')]);

  const allTrades=[];

  for(const ticker of TICKERS){
    process.stdout.write(`${ticker}... `);
    const [data5m,dailyData]=await Promise.all([fetchChart(ticker,'5m','1mo'),fetchChart(ticker,'1d','3mo')]);
    if(!data5m||data5m.timestamps.length<100){console.log('skip');continue;}
    const days=groupByDay(data5m.timestamps);const dayKeys=Object.keys(days).sort();
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[];const dTs=dailyData?dailyData.timestamps:[];const dEma10=calcEMA(dCloses,10);
    function getDayTrend(dk){if(dCloses.length<12)return'NEUTRAL';const ts=new Date(dk+'T12:00:00').getTime()/1000;let idx=-1;for(let i=dTs.length-1;i>=0;i--){if(dTs[i]<=ts+86400){idx=i;break;}}if(idx<10)return'NEUTRAL';if(dCloses[idx]>dEma10[idx]&&dCloses[idx-1]>dCloses[idx-2])return'UP';if(dCloses[idx]<dEma10[idx]&&dCloses[idx-1]<dCloses[idx-2])return'DOWN';return'NEUTRAL';}

    let tc=0;
    for(const dk of dayKeys){
      const indices=days[dk];if(!indices||indices.length<20)continue;
      const dt=getDayTrend(dk);

      // PM range
      let pmh=-Infinity,pml=Infinity,pmc=0;
      for(const ci of indices){const m=getMinutesET(data5m.timestamps[ci]);if(m>=240&&m<570){if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];pmc++;}}
      const pmRange=pmh!==-Infinity?pmh-pml:0;

      // ORB first 5min candle
      const fc=indices.find(ci=>getMinutesET(data5m.timestamps[ci])>=570);
      if(fc==null)continue;
      const orbH=data5m.highs[fc],orbL=data5m.lows[fc];if(!orbH||!orbL)continue;
      const orbRange=orbH-orbL;

      // FILTERS
      if(pmRange>6)continue; // PM range > $6 = skip
      if(orbRange<0.80)continue; // ORB too tight = noise

      const regAfter=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<960;});
      if(regAfter.length<10)continue;

      let touchedUp=false;
      for(let ri=0;ri<regAfter.length-1&&!touchedUp;ri++){
        const ci=regAfter[ri];const h=data5m.highs[ci];if(!h||h<=orbH)continue;
        touchedUp=true;
        const breakTs=data5m.timestamps[ci];
        const time=new Date(breakTs*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        // Trend filter
        if(dt==='DOWN')continue;

        // SPX+VIX convergence
        const spxOk=check5m(spxD,breakTs,'CALL',false);
        const vixOk=check5m(vixD,breakTs,'CALL',true);
        if(!spxOk||!vixOk)continue;

        const entry=+orbH.toFixed(2),sl=+orbL.toFixed(2),tp=+(orbH+orbRange*2).toFixed(2);
        const eod=regAfter[regAfter.length-1];
        const res=simulateTrade('CALL',entry,sl,tp,data5m,ci,eod);
        const exitTime=new Date(data5m.timestamps[res.exitIdx]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        // Determine if it was a "real" loss or salvable
        const touchedSL=res.type==='STOP';
        const realResult=res.pnl>0?'WIN':touchedSL?'LOSS':'BE';

        allTrades.push({
          date:dk,time,exitTime,ticker,
          orbH:+orbH.toFixed(2),orbL:+orbL.toFixed(2),orbRange:+orbRange.toFixed(2),
          pmRange:+pmRange.toFixed(2),
          entry,sl,tp,
          pnl:+res.pnl.toFixed(2),exitType:res.type,
          result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
          realResult,
          maxFav:+res.maxFav.toFixed(2),dayTrend:dt,
        });
        tc++;
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  allTrades.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
  const MULT=50;

  console.log('\n'+'='.repeat(140));
  console.log('ORB 5min CALL + SPX+VIX | PM range < $6 | ORB range > $0.80 | Tendencia UP/NEUTRAL');
  console.log('='.repeat(140));

  console.log(`\n${'#'.padEnd(3)} ${'Fecha'.padEnd(11)} ${'Hora'.padEnd(9)} ${'Exit'.padEnd(9)} ${'Ticker'.padEnd(7)} ${'PMrng'.padEnd(7)} ${'ORBrng'.padEnd(7)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP'.padEnd(9)} ${'PnL'.padEnd(8)} ${'$2c'.padEnd(7)} ${'MaxFav'.padEnd(7)} ${'ExitType'.padEnd(9)} Real`);
  console.log('-'.repeat(140));

  let currentDay='';
  for(let i=0;i<allTrades.length;i++){
    const t=allTrades[i];
    if(t.date!==currentDay&&currentDay){
      const dt=allTrades.filter(x=>x.date===currentDay);
      const dp=dt.reduce((s,x)=>s+x.pnl,0)*MULT;
      const dw=dt.filter(x=>x.realResult==='WIN').length;const dl=dt.filter(x=>x.realResult==='LOSS').length;const db=dt.filter(x=>x.realResult==='BE').length;
      console.log(`${''.padEnd(100)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)} (${dw}W ${dl}L ${db}BE real)`);console.log('');
    }
    currentDay=t.date;
    const cp=t.pnl*MULT;
    const icon=t.realResult==='WIN'?'✅':t.realResult==='BE'?'⚪':'❌';
    console.log(
      String(i+1).padEnd(3)+
      t.date.padEnd(11)+t.time.padEnd(9)+t.exitTime.padEnd(9)+t.ticker.padEnd(7)+
      '$'+t.pmRange.toFixed(1).padEnd(6)+
      '$'+t.orbRange.toFixed(2).padEnd(6)+
      ' $'+String(t.entry).padEnd(8)+
      '$'+String(t.sl).padEnd(8)+
      ' $'+String(t.tp).padEnd(8)+
      (t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(7)+' '+
      (cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(5)+'  '+
      '$'+t.maxFav.toFixed(2).padStart(5)+'   '+
      t.exitType.padEnd(9)+
      icon+' '+t.realResult
    );
  }
  // Last day
  {const dt=allTrades.filter(x=>x.date===currentDay);const dp=dt.reduce((s,x)=>s+x.pnl,0)*MULT;const dw=dt.filter(x=>x.realResult==='WIN').length;const dl=dt.filter(x=>x.realResult==='LOSS').length;const db=dt.filter(x=>x.realResult==='BE').length;
  console.log(`${''.padEnd(100)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)} (${dw}W ${dl}L ${db}BE real)`);}

  // Summary
  const w=allTrades.filter(t=>t.realResult==='WIN').length;
  const l=allTrades.filter(t=>t.realResult==='LOSS').length;
  const b=allTrades.filter(t=>t.realResult==='BE').length;
  const pnl=allTrades.reduce((s,t)=>s+t.pnl,0);
  const cpnl=pnl*MULT;
  const gw=allTrades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const gl=Math.abs(allTrades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
  const days=new Set(allTrades.map(t=>t.date)).size;
  const greenDays=Object.entries(allTrades.reduce((d,t)=>{d[t.date]=(d[t.date]||0)+t.pnl;return d;},{})).filter(([,v])=>v>0).length;

  console.log('\n'+'='.repeat(140));
  console.log('RESUMEN FINAL');
  console.log(`Trades: ${allTrades.length} en ${days} días (${(allTrades.length/days).toFixed(1)}/día)`);
  console.log(`Resultado real: ${w} WIN | ${l} LOSS | ${b} BE`);
  console.log(`WR real (WIN+BE vs LOSS): ${(((w+b)/allTrades.length)*100).toFixed(0)}%`);
  console.log(`WR estricto (solo WIN): ${((w/allTrades.length)*100).toFixed(0)}%`);
  console.log(`PF: ${gl>0?(gw/gl).toFixed(2):'∞'}`);
  console.log(`2 contratos: $${cpnl.toFixed(0)} ($${(cpnl/days).toFixed(0)}/día)`);
  console.log(`Días verdes: ${greenDays}/${days} (${((greenDays/days)*100).toFixed(0)}%)`);
  console.log(`Avg ORB range: $${(allTrades.reduce((s,t)=>s+t.orbRange,0)/allTrades.length).toFixed(2)}`);
  console.log(`Avg PM range: $${(allTrades.reduce((s,t)=>s+t.pmRange,0)/allTrades.length).toFixed(2)}`);

  // By ticker
  console.log('\n--- POR TICKER ---');
  for(const ticker of TICKERS){
    const tt=allTrades.filter(t=>t.ticker===ticker);if(!tt.length)continue;
    const tw=tt.filter(t=>t.realResult==='WIN').length;const tl=tt.filter(t=>t.realResult==='LOSS').length;const tb=tt.filter(t=>t.realResult==='BE').length;
    const tp=tt.reduce((s,t)=>s+t.pnl,0)*MULT;
    console.log(`  ${ticker.padEnd(6)} ${tt.length} trades | ${tw}W ${tl}L ${tb}BE | WR ${(((tw+tb)/tt.length)*100).toFixed(0)}% | $${tp.toFixed(0)}`);
  }
}

run().catch(console.error);
