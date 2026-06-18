// Simulate DAILY PnL with 2 contracts, max N trades/day
// Test best strategy combos and show realistic daily income

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker, interval, range, p1=null, p2=null) {
  let url;
  if(p1&&p2) url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&period1=${p1}&period2=${p2}&includePrePost=true`;
  else url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
  const data=await res.json(); const result=data?.chart?.result?.[0]; if(!result) return null;
  const q=result.indicators?.quote?.[0]||{};
  return {timestamps:result.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};
}

async function fetch1minMonth(ticker) {
  const now=Math.floor(Date.now()/1000);const chunks=[];
  for(let i=0;i<4;i++){const end=now-i*7*86400,start=end-7*86400;const d=await fetchChart(ticker,'1m',null,start,end);if(d&&d.timestamps.length>0)chunks.unshift(d);await new Promise(r=>setTimeout(r,300));}
  if(!chunks.length)return null;const m={timestamps:[],closes:[]};const seen=new Set();
  for(const c of chunks)for(let i=0;i<c.timestamps.length;i++){if(!seen.has(c.timestamps[i])){seen.add(c.timestamps[i]);m.timestamps.push(c.timestamps[i]);m.closes.push(c.closes[i]);}}
  return m;
}

function getStop(p){return p<100?0.5:p<250?1:p<400?1.5:p<550?2:2.5;}
function calcEMA(a,p){const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return `${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}

function checkIdx(data,ts,dir,inv){
  let idx=-1;for(let i=data.timestamps.length-1;i>=0;i--){if(data.timestamps[i]<=ts){idx=i;break;}}
  if(idx<3)return false;const c=data.closes;if(c[idx]==null||c[idx-1]==null||c[idx-3]==null)return false;
  const p=c[idx],t3=p-c[idx-3],t1=p-c[idx-1],th=p*0.00003;
  if(inv)return dir==='CALL'?(t3<-th&&t1<=0):(t3>th&&t1>=0);
  return dir==='CALL'?(t3>th&&t1>=0):(t3<-th&&t1<=0);
}

function simulateTrade(dir,entry,sd,data,si,ei){
  const tgt=dir==='CALL'?entry+sd*3:entry-sd*3;
  let stop=dir==='CALL'?entry-sd:entry+sd,be=false,maxFav=0;
  for(let j=si+1;j<=ei;j++){
    const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){maxFav=Math.max(maxFav,h-entry);if(h>=entry+sd&&!be){stop=entry;be=true;}if(l<=stop)return{pnl:stop-entry,type:be?'BE':'STOP',maxFav};if(h>=tgt)return{pnl:tgt-entry,type:'TARGET',maxFav};}
    else{maxFav=Math.max(maxFav,entry-l);if(entry-l>=sd&&!be){stop=entry;be=true;}if(h>=stop)return{pnl:entry-stop,type:be?'BE':'STOP',maxFav};if(l<=tgt)return{pnl:entry-tgt,type:'TARGET',maxFav};}
  }
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD',maxFav};
}

function mergeLevels(levels){
  const pri={PDH:3,PDL:3,PMH:2,PML:2};const sorted=[...levels].sort((a,b)=>a.price-b.price);
  const merged=[],used=new Set();
  for(let i=0;i<sorted.length;i++){if(used.has(i))continue;let best=sorted[i];
    for(let j=i+1;j<sorted.length;j++){if(used.has(j))continue;if(Math.abs(sorted[j].price-best.price)/best.price<0.005){if((pri[sorted[j].name]||0)>(pri[best.name]||0)){used.add(i);best=sorted[j];}used.add(j);}}
    merged.push(best);}return merged;
}

async function run(){
  console.log('Loading data...');
  const [nq1m,spx1m,spy1m,vix1m]=await Promise.all([
    fetch1minMonth('NQ=F'),fetch1minMonth('^GSPC'),fetch1minMonth('SPY'),fetch1minMonth('^VIX')
  ]);

  // Collect ALL trades with all metadata
  const allTrades=[];

  for(const ticker of TICKERS){
    process.stdout.write(`${ticker}... `);
    const [data5m,dailyData]=await Promise.all([fetchChart(ticker,'5m','1mo'),fetchChart(ticker,'1d','3mo')]);
    if(!data5m||data5m.timestamps.length<50){console.log('skip');continue;}
    const days=groupByDay(data5m.timestamps);const dayKeys=Object.keys(days).sort();
    const ema10=calcEMA(data5m.closes,10);
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[];
    const dTs=dailyData?dailyData.timestamps:[];const dEma10=calcEMA(dCloses,10);

    function getDayTrend(dk){
      if(dCloses.length<12)return'NEUTRAL';const ts=new Date(dk+'T12:00:00').getTime()/1000;
      let idx=-1;for(let i=dTs.length-1;i>=0;i--){if(dTs[i]<=ts+86400){idx=i;break;}}
      if(idx<10)return'NEUTRAL';
      if(dCloses[idx]>dEma10[idx]&&dCloses[idx-1]>dCloses[idx-2])return'UP';
      if(dCloses[idx]<dEma10[idx]&&dCloses[idx-1]<dCloses[idx-2])return'DOWN';
      return'NEUTRAL';
    }

    let tc=0;
    for(let di=1;di<dayKeys.length;di++){
      const dk=dayKeys[di],pdk=dayKeys[di-1];
      const indices=days[dk],prevIndices=days[pdk];
      if(!prevIndices||indices.length<15)continue;
      let rawLevels=[];let pdh=-Infinity,pdl=Infinity;
      for(const pi of prevIndices){const m=getMinutesET(data5m.timestamps[pi]);if(m>=570&&m<960){if(data5m.highs[pi]!=null&&data5m.highs[pi]>pdh)pdh=data5m.highs[pi];if(data5m.lows[pi]!=null&&data5m.lows[pi]<pdl)pdl=data5m.lows[pi];}}
      if(pdh!==-Infinity){rawLevels.push({name:'PDH',price:+pdh.toFixed(2)});rawLevels.push({name:'PDL',price:+pdl.toFixed(2)});}
      let pmh=-Infinity,pml=Infinity,pmc=0;
      for(const ci of indices){const m=getMinutesET(data5m.timestamps[ci]);if(m>=240&&m<570){if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];pmc++;}}
      if(pmc>=3&&pmh!==-Infinity){rawLevels.push({name:'PMH',price:+pmh.toFixed(2)});rawLevels.push({name:'PML',price:+pml.toFixed(2)});}
      const levels=mergeLevels(rawLevels);if(!levels.length)continue;
      const dt=getDayTrend(dk);
      const touched={};
      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<955;});

      for(let ri=1;ri<regIdx.length;ri++){
        const ci=regIdx[ri],pci=regIdx[ri-1];
        const price=data5m.closes[ci],h=data5m.highs[ci],l=data5m.lows[ci],o=data5m.opens[ci],c=data5m.closes[ci];
        if(!price||!h||!l||!o)continue;
        const body=Math.abs(c-o),wU=h-Math.max(c,o),wD=Math.min(c,o)-l;
        const sd=getStop(price);const pH=data5m.highs[pci],pL=data5m.lows[pci];
        const cts=data5m.timestamps[ci];const mins=getMinutesET(cts);
        const e10=ema10[ci];const e10slope=ci>=3?ema10[ci]-ema10[ci-3]:0;
        const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        for(const lv of levels){
          let dir=null,type=null;
          if(h>lv.price&&pH!=null&&pH<=lv.price){dir='CALL';type='BRK';}
          else if(l<lv.price&&pL!=null&&pL>=lv.price){dir='PUT';type='BRK';}
          else if(l<=lv.price*1.002&&c>lv.price&&wD>body*2&&wD>0.10){dir='CALL';type='REJ';}
          else if(h>=lv.price*0.998&&c<lv.price&&wU>body*2&&wU>0.10){dir='PUT';type='REJ';}
          if(!dir)continue;
          const tk=`${lv.name}_${type}_${dir}`;if(touched[tk])continue;

          // NQ+SPX convergence (original)
          const convOrig=checkIdx(nq1m,cts,dir,false)&&checkIdx(spx1m,cts,dir,false);
          if(!convOrig)continue;
          touched[tk]=true;

          const spyConv=checkIdx(spy1m,cts,dir,false);
          const vixConv=checkIdx(vix1m,cts,dir,true);
          const trendOk=(dir==='CALL'&&dt!=='DOWN')||(dir==='PUT'&&dt!=='UP');
          const emaOk=dir==='CALL'?(price>e10&&e10slope>0.02):(price<e10&&e10slope<-0.02);
          const session=mins<630?'OPEN':mins<840?'MID':'AFT';

          const eod=regIdx[regIdx.length-1];
          const res=simulateTrade(dir,price,sd,data5m,ci,eod);

          allTrades.push({
            date:dk,time,ticker,dir,type,level:lv.name,entry:+price.toFixed(2),
            pnl:+res.pnl.toFixed(2),exitType:res.type,maxFav:+res.maxFav.toFixed(2),
            result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
            stopDist:sd,
            // Filters
            trendOk,spyConv,vixConv,emaOk,session,dayTrend:dt,
          });
          tc++;
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  // === STRATEGY SIMULATIONS WITH DAILY LIMITS ===
  const DELTA = 0.50;
  const CONTRACTS = 2;
  const SHARES = CONTRACTS * 100;

  const strategies = [
    { name: 'Trend+SPY+VIX (no limit)', filter: t=>t.trendOk&&t.spyConv&&t.vixConv, maxPerDay: 999 },
    { name: 'Trend+SPY+VIX (max 3/day)', filter: t=>t.trendOk&&t.spyConv&&t.vixConv, maxPerDay: 3 },
    { name: 'Trend+SPY+VIX (max 2/day)', filter: t=>t.trendOk&&t.spyConv&&t.vixConv, maxPerDay: 2 },
    { name: 'Trend+SPY+VIX (max 1/day)', filter: t=>t.trendOk&&t.spyConv&&t.vixConv, maxPerDay: 1 },
    { name: 'Trend+SPY+VIX AFT only (max 2)', filter: t=>t.trendOk&&t.spyConv&&t.vixConv&&t.session==='AFT', maxPerDay: 2 },
    { name: 'Trend+SPY+VIX no OPEN (max 2)', filter: t=>t.trendOk&&t.spyConv&&t.vixConv&&t.session!=='OPEN', maxPerDay: 2 },
    { name: 'Trend+SPY+VIX no OPEN (max 3)', filter: t=>t.trendOk&&t.spyConv&&t.vixConv&&t.session!=='OPEN', maxPerDay: 3 },
    { name: 'Trend only (max 2)', filter: t=>t.trendOk, maxPerDay: 2 },
    { name: 'ALL filters (max 2)', filter: t=>t.trendOk&&t.spyConv&&t.vixConv&&t.emaOk, maxPerDay: 2 },
  ];

  console.log('\n'+'='.repeat(110));
  console.log(`SIMULACION CON ${CONTRACTS} CONTRATOS (delta ${DELTA}) — ¿Cuánto por día?`);
  console.log('='.repeat(110));

  for(const strat of strategies){
    const filtered=allTrades.filter(strat.filter);

    // Group by day, take first N
    const byDay={};
    filtered.forEach(t=>{if(!byDay[t.date])byDay[t.date]=[];byDay[t.date].push(t);});

    const taken=[];
    const dailyPnl={};
    for(const [day,trades] of Object.entries(byDay)){
      const dayTrades=trades.slice(0,strat.maxPerDay);
      taken.push(...dayTrades);
      // PnL in dollars with contracts
      const stockPnl=dayTrades.reduce((s,t)=>s+t.pnl,0);
      const contractPnl=stockPnl*DELTA*SHARES/CONTRACTS; // per contract pair
      dailyPnl[day]=+contractPnl.toFixed(2);
    }

    const w=taken.filter(t=>t.result==='WIN').length;
    const l=taken.filter(t=>t.result==='LOSS').length;
    const b=taken.filter(t=>t.result==='BE').length;
    const stockPnl=taken.reduce((s,t)=>s+t.pnl,0);
    const dollarPnl=stockPnl*DELTA*SHARES/CONTRACTS;
    const days=Object.keys(dailyPnl).length;
    const avgDay=days?dollarPnl/days:0;
    const greenDays=Object.values(dailyPnl).filter(v=>v>0).length;
    const redDays=Object.values(dailyPnl).filter(v=>v<0).length;
    const flatDays=Object.values(dailyPnl).filter(v=>v===0).length;
    const bestDay=Math.max(...Object.values(dailyPnl));
    const worstDay=Math.min(...Object.values(dailyPnl));
    const gw=taken.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gl=Math.abs(taken.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    const pf=gl>0?(gw/gl).toFixed(2):'∞';

    console.log(`\n${strat.name}`);
    console.log(`  Trades: ${taken.length} (${days} days, ${(taken.length/days).toFixed(1)}/day) | W:${w} L:${l} BE:${b} | PF ${pf}`);
    console.log(`  Stock PnL: $${stockPnl.toFixed(2)} | Contract PnL: $${dollarPnl.toFixed(0)} (${CONTRACTS} contracts)`);
    console.log(`  Avg/day: $${avgDay.toFixed(0)} | Best: $${bestDay.toFixed(0)} | Worst: $${worstDay.toFixed(0)}`);
    console.log(`  Green days: ${greenDays}/${days} (${((greenDays/days)*100).toFixed(0)}%) | Red: ${redDays} | Flat: ${flatDays}`);

    // Show daily breakdown
    if(strat.maxPerDay<=3){
      const sortedDays=Object.entries(dailyPnl).sort((a,b)=>a[0].localeCompare(b[0]));
      console.log(`  Daily: ${sortedDays.map(([d,p])=>`${d.slice(5)}:${p>=0?'+':''}$${p.toFixed(0)}`).join(' | ')}`);
    }
  }
}

run().catch(console.error);
