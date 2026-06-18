// TEST v2: PM breakouts with RELAXED convergence (15min trend, not 3 candles)
// + analyze ALL PM ranges to find the sweet spot

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range,p1=null,p2=null){
  let url;if(p1&&p2)url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&period1=${p1}&period2=${p2}&includePrePost=true`;
  else url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

function getStop(p){return p<100?0.5:p<250?1:p<400?1.5:p<550?2:2.5;}
function calcEMA(a,p){if(!a||a.length<p)return[];const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}

// RELAXED convergence: SPY trending in last 15min (3 candles of 5min)
function checkTrend5m(data, ts, dir) {
  let idx=-1;for(let i=data.timestamps.length-1;i>=0;i--){if(data.timestamps[i]<=ts){idx=i;break;}}
  if(idx<3)return false;const c=data.closes;
  if(c[idx]==null||c[idx-3]==null)return false;
  const change=c[idx]-c[idx-3];
  if(dir==='CALL')return change>0;
  return change<0;
}

function simulateTrade(dir,entry,sd,tgtMult,data,si,ei){
  const tgt=dir==='CALL'?entry+sd*tgtMult:entry-sd*tgtMult;
  let stop=dir==='CALL'?entry-sd:entry+sd,be=false,maxFav=0;
  for(let j=si+1;j<=ei;j++){const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){maxFav=Math.max(maxFav,h-entry);if(h>=entry+sd&&!be){stop=entry;be=true;}if(l<=stop)return{pnl:stop-entry,type:be?'BE':'STOP',maxFav};if(h>=tgt)return{pnl:tgt-entry,type:'TARGET',maxFav};}
    else{maxFav=Math.max(maxFav,entry-l);if(entry-l>=sd&&!be){stop=entry;be=true;}if(h>=stop)return{pnl:entry-stop,type:be?'BE':'STOP',maxFav};if(l<=tgt)return{pnl:entry-tgt,type:'TARGET',maxFav};}}
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD',maxFav};}

async function run(){
  console.log('Loading...');
  const [spyData, vixData] = await Promise.all([
    fetchChart('SPY','5m','1mo'),
    fetchChart('^VIX','5m','1mo'),
  ]);
  const spyDays=groupByDay(spyData.timestamps);
  const vixDays=groupByDay(vixData.timestamps);

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
      const dk=dayKeys[di];const indices=days[dk];
      if(!indices||indices.length<20)continue;
      const dt=getDayTrend(dk);

      // PM levels
      let pmh=-Infinity,pml=Infinity,pmc=0;
      for(const ci of indices){const m=getMinutesET(data5m.timestamps[ci]);if(m>=240&&m<570){if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];pmc++;}}
      if(pmc<3||pmh===-Infinity)continue;
      const pmRange=pmh-pml;

      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<955;});
      if(regIdx.length<10)continue;

      let touchedH=false,touchedL=false;
      for(let ri=1;ri<regIdx.length-3;ri++){
        const ci=regIdx[ri],pci=regIdx[ri-1];
        const price=data5m.closes[ci],h=data5m.highs[ci],l=data5m.lows[ci];
        if(!price||!h||!l)continue;
        const prevH=data5m.highs[pci],prevL=data5m.lows[pci];
        const sd=getStop(price);const cts=data5m.timestamps[ci];
        const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        // PMH breakout
        if(!touchedH&&h>pmh&&prevH!=null&&prevH<=pmh){
          if(dt!=='DOWN'){
            // Check SPY up + VIX down (relaxed: 5min trend)
            const spyOk=checkTrend5m(spyData,cts,'CALL');
            const vixOk=checkTrend5m(vixData,cts,'PUT'); // VIX should be dropping for CALL

            const eod=regIdx[regIdx.length-1];
            const res2=simulateTrade('CALL',price,sd,2,data5m,ci,eod);
            const res3=simulateTrade('CALL',price,sd,3,data5m,ci,eod);

            touchedH=true;tc++;
            allTrades.push({
              date:dk,time,ticker,dir:'CALL',level:'PMH',levelPrice:+pmh.toFixed(2),
              entry:+price.toFixed(2),sd,
              pnl2:+res2.pnl.toFixed(2),res2:res2.pnl>0?'WIN':res2.pnl===0?'BE':'LOSS',
              pnl3:+res3.pnl.toFixed(2),res3:res3.pnl>0?'WIN':res3.pnl===0?'BE':'LOSS',
              maxFav:+res2.maxFav.toFixed(2),
              pmRange:+pmRange.toFixed(2),dayTrend:dt,
              spyOk,vixOk,bothOk:spyOk&&vixOk,
            });
          }
        }

        // PML breakout
        if(!touchedL&&l<pml&&prevL!=null&&prevL>=pml){
          if(dt!=='UP'){
            const spyOk=checkTrend5m(spyData,cts,'PUT');
            const vixOk=checkTrend5m(vixData,cts,'CALL'); // VIX should be rising for PUT

            const eod=regIdx[regIdx.length-1];
            const res2=simulateTrade('PUT',price,sd,2,data5m,ci,eod);
            const res3=simulateTrade('PUT',price,sd,3,data5m,ci,eod);

            touchedL=true;tc++;
            allTrades.push({
              date:dk,time,ticker,dir:'PUT',level:'PML',levelPrice:+pml.toFixed(2),
              entry:+price.toFixed(2),sd,
              pnl2:+res2.pnl.toFixed(2),res2:res2.pnl>0?'WIN':res2.pnl===0?'BE':'LOSS',
              pnl3:+res3.pnl.toFixed(2),res3:res3.pnl>0?'WIN':res3.pnl===0?'BE':'LOSS',
              maxFav:+res2.maxFav.toFixed(2),
              pmRange:+pmRange.toFixed(2),dayTrend:dt,
              spyOk,vixOk,bothOk:spyOk&&vixOk,
            });
          }
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  allTrades.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
  const MULT=0.50*2*100/2;

  console.log('\n'+'='.repeat(110));
  console.log('PM BREAKOUT ANALYSIS — 1 mes, todas las rangos');
  console.log('='.repeat(110));

  // By PM range + convergence
  const combos=[
    {label:'Todos (sin filtro)',fn:t=>true},
    {label:'SPY+VIX confirma',fn:t=>t.bothOk},
    {label:'Solo SPY confirma',fn:t=>t.spyOk},
    {label:'Solo VIX confirma',fn:t=>t.vixOk},
    {label:'PM $2-5',fn:t=>t.pmRange>=2&&t.pmRange<5},
    {label:'PM $2-5 + SPY+VIX',fn:t=>t.pmRange>=2&&t.pmRange<5&&t.bothOk},
    {label:'PM $2-5 + solo SPY',fn:t=>t.pmRange>=2&&t.pmRange<5&&t.spyOk},
    {label:'PM $3-8',fn:t=>t.pmRange>=3&&t.pmRange<8},
    {label:'PM $3-8 + SPY+VIX',fn:t=>t.pmRange>=3&&t.pmRange<8&&t.bothOk},
    {label:'PMH only (CALL)',fn:t=>t.level==='PMH'},
    {label:'PMH $2-5 + SPY+VIX',fn:t=>t.level==='PMH'&&t.pmRange>=2&&t.pmRange<5&&t.bothOk},
    {label:'PMH any + SPY+VIX',fn:t=>t.level==='PMH'&&t.bothOk},
  ];

  console.log('\n--- TARGET 1:2 ---');
  for(const c of combos){
    const bt=allTrades.filter(c.fn);if(!bt.length){console.log(`  ${c.label.padEnd(28)} — sin trades`);continue;}
    const w=bt.filter(t=>t.res2==='WIN').length;const l=bt.filter(t=>t.res2==='LOSS').length;const be=bt.filter(t=>t.res2==='BE').length;
    const pnl=bt.reduce((s,t)=>s+t.pnl2,0);const gw=bt.filter(t=>t.pnl2>0).reduce((s,t)=>s+t.pnl2,0);const gl=Math.abs(bt.filter(t=>t.pnl2<0).reduce((s,t)=>s+t.pnl2,0));
    const days=new Set(bt.map(t=>t.date)).size;
    console.log(`  ${c.label.padEnd(28)} ${String(bt.length).padStart(3)} trades | ${String(w).padStart(2)}W ${String(l).padStart(2)}L ${String(be).padStart(2)}BE | WR ${((w/bt.length)*100).toFixed(0).padStart(2)}% | PF ${(gl>0?(gw/gl).toFixed(2):'∞').padStart(5)} | $${(pnl*MULT).toFixed(0).padStart(6)} | ${(pnl*MULT/days).toFixed(0)}/d`);
  }

  // Show all trades
  console.log('\n\n'+'='.repeat(130));
  console.log('TODOS LOS PM BREAKOUTS — trade por trade');
  console.log('='.repeat(130));
  console.log(`\n${'Fecha'.padEnd(11)} ${'Hora'.padEnd(9)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Lvl'.padEnd(4)} ${'PMrng'.padEnd(7)} ${'Entry'.padEnd(9)} ${'PnL(2x)'.padEnd(9)} ${'Res'.padEnd(6)} ${'PnL(3x)'.padEnd(9)} ${'Res'.padEnd(6)} ${'MaxFav'.padEnd(7)} ${'SPY'.padEnd(4)} ${'VIX'.padEnd(4)} Trend`);
  console.log('-'.repeat(120));

  for(const t of allTrades){
    const i2=t.res2==='WIN'?'✅':t.res2==='BE'?'⚪':'❌';
    const i3=t.res3==='WIN'?'✅':t.res3==='BE'?'⚪':'❌';
    console.log(`${t.date.padEnd(11)} ${t.time.padEnd(9)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} ${t.level.padEnd(4)} $${t.pmRange.toFixed(1).padStart(5)} $${String(t.entry).padEnd(8)} ${(t.pnl2>=0?'+':'')+t.pnl2.toFixed(2).padStart(6)} ${i2}${t.res2.padEnd(4)} ${(t.pnl3>=0?'+':'')+t.pnl3.toFixed(2).padStart(6)} ${i3}${t.res3.padEnd(4)} $${t.maxFav.toFixed(2).padStart(5)} ${t.spyOk?'✅':'❌'}   ${t.vixOk?'✅':'❌'}   ${t.dayTrend}`);
  }
}

run().catch(console.error);
