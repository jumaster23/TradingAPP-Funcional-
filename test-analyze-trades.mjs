// ANALYZE each trade from Ultra Simple to find what winners have in common
// For each trade, capture: EMA10 position, VWAP position, volume, time, SPY trend, VIX trend

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker, interval, range, p1=null, p2=null) {
  let url;
  if(p1&&p2) url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&period1=${p1}&period2=${p2}&includePrePost=true`;
  else url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0'}});
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if(!result) return null;
  const q = result.indicators?.quote?.[0]||{};
  return {timestamps:result.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};
}

async function fetch1minMonth(ticker) {
  const now=Math.floor(Date.now()/1000); const chunks=[];
  for(let i=0;i<4;i++){const end=now-i*7*86400,start=end-7*86400;const d=await fetchChart(ticker,'1m',null,start,end);if(d&&d.timestamps.length>0)chunks.unshift(d);await new Promise(r=>setTimeout(r,300));}
  if(!chunks.length)return null;
  const m={timestamps:[],closes:[]};const seen=new Set();
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
    if(dir==='CALL'){
      maxFav=Math.max(maxFav,h-entry);
      if(h>=entry+sd&&!be){stop=entry;be=true;}
      if(l<=stop)return{pnl:stop-entry,type:be?'BE':'STOP',maxFav};
      if(h>=tgt)return{pnl:tgt-entry,type:'TARGET',maxFav};
    }else{
      maxFav=Math.max(maxFav,entry-l);
      if(entry-l>=sd&&!be){stop=entry;be=true;}
      if(h>=stop)return{pnl:entry-stop,type:be?'BE':'STOP',maxFav};
      if(l<=tgt)return{pnl:entry-tgt,type:'TARGET',maxFav};
    }
  }
  const ep=data.closes[ei]||entry;
  return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD',maxFav};
}

function mergeLevels(levels){
  const pri={PDH:3,PDL:3,PMH:2,PML:2};const sorted=[...levels].sort((a,b)=>a.price-b.price);
  const merged=[],used=new Set();
  for(let i=0;i<sorted.length;i++){if(used.has(i))continue;let best=sorted[i];
    for(let j=i+1;j<sorted.length;j++){if(used.has(j))continue;if(Math.abs(sorted[j].price-best.price)/best.price<0.005){if((pri[sorted[j].name]||0)>(pri[best.name]||0)){used.add(i);best=sorted[j];}used.add(j);}}
    merged.push(best);}return merged;
}

async function run(){
  console.log('Fetching convergence data...');
  const [nq1m,spx1m,spy1m,vix1m]=await Promise.all([
    fetch1minMonth('NQ=F'),fetch1minMonth('^GSPC'),fetch1minMonth('SPY'),fetch1minMonth('^VIX')
  ]);

  const allTrades=[];

  for(const ticker of TICKERS){
    process.stdout.write(`${ticker}... `);
    const [data5m,dailyData]=await Promise.all([fetchChart(ticker,'5m','1mo'),fetchChart(ticker,'1d','3mo')]);
    if(!data5m||data5m.timestamps.length<50){console.log('skip');continue;}

    const days=groupByDay(data5m.timestamps);
    const dayKeys=Object.keys(days).sort();
    const ema10=calcEMA(data5m.closes,10);
    const ema20=calcEMA(data5m.closes,20);
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[];
    const dTs=dailyData?dailyData.timestamps:[];
    const dEma10=calcEMA(dCloses,10);

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

      // VWAP
      let vN=0,vD=0;const dayVwaps=[];
      for(const ci of indices){if(data5m.highs[ci]!=null&&data5m.lows[ci]!=null&&data5m.closes[ci]!=null&&data5m.volumes[ci]!=null){vN+=((data5m.highs[ci]+data5m.lows[ci]+data5m.closes[ci])/3)*data5m.volumes[ci];vD+=data5m.volumes[ci];}dayVwaps.push(vD?vN/vD:null);}

      const touched={};
      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<955;});

      for(let ri=1;ri<regIdx.length;ri++){
        const ci=regIdx[ri],pci=regIdx[ri-1];
        const price=data5m.closes[ci],h=data5m.highs[ci],l=data5m.lows[ci],o=data5m.opens[ci],c=data5m.closes[ci];
        if(!price||!h||!l||!o)continue;
        const body=Math.abs(c-o),wU=h-Math.max(c,o),wD=Math.min(c,o)-l;
        const sd=getStop(price);
        const pH=data5m.highs[pci],pL=data5m.lows[pci];
        const cts=data5m.timestamps[ci];
        const mins=getMinutesET(cts);
        const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        // Indicators at this candle
        const e10=ema10[ci],e20=ema20[ci];
        const e10slope=ci>=3?ema10[ci]-ema10[ci-3]:0;
        const vwapIdx=indices.indexOf(ci);
        const vwap=vwapIdx>=0?dayVwaps[vwapIdx]:null;

        // Volume
        const volSlice=data5m.volumes.slice(Math.max(0,ci-20),ci+1).filter(v=>v!=null&&v>0);
        const avgVol=volSlice.length?volSlice.reduce((a,b)=>a+b,0)/volSlice.length:1;
        const relVol=(data5m.volumes[ci]||0)/avgVol;

        // Convergences
        const nqSpxConv=checkIdx(nq1m,cts,'CALL',false)&&checkIdx(spx1m,cts,'CALL',false)||checkIdx(nq1m,cts,'PUT',false)&&checkIdx(spx1m,cts,'PUT',false);

        for(const lv of levels){
          let dir=null,type=null;
          if(h>lv.price&&pH!=null&&pH<=lv.price){dir='CALL';type='BRK';}
          else if(l<lv.price&&pL!=null&&pL>=lv.price){dir='PUT';type='BRK';}
          else if(l<=lv.price*1.002&&c>lv.price&&wD>body*2&&wD>0.10){dir='CALL';type='REJ';}
          else if(h>=lv.price*0.998&&c<lv.price&&wU>body*2&&wU>0.10){dir='PUT';type='REJ';}
          if(!dir)continue;
          const tk=`${lv.name}_${type}_${dir}`;
          if(touched[tk])continue;

          // Check NQ+SPX convergence (original)
          const convNqSpx=checkIdx(nq1m,cts,dir,false)&&checkIdx(spx1m,cts,dir,false);
          if(!convNqSpx)continue;
          touched[tk]=true;tc++;

          const eod=regIdx[regIdx.length-1];
          const res=simulateTrade(dir,price,sd,data5m,ci,eod);

          // Capture ALL context for analysis
          const emaAligned=dir==='CALL'?(price>e10&&e10slope>0.02):(price<e10&&e10slope<-0.02);
          const vwapAligned=vwap?(dir==='CALL'?price>vwap:price<vwap):null;
          const spyConv=checkIdx(spy1m,cts,dir,false);
          const vixConv=checkIdx(vix1m,cts,dir,true);
          const trendAligned=(dir==='CALL'&&dt!=='DOWN')||(dir==='PUT'&&dt!=='UP');

          allTrades.push({
            date:dk,time,ticker,dir,type,level:lv.name,
            entry:+price.toFixed(2),pnl:+res.pnl.toFixed(2),exitType:res.type,
            result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
            maxFav:+res.maxFav.toFixed(2),
            // Context
            emaAligned, vwapAligned, spyConv, vixConv, trendAligned,
            relVol:+relVol.toFixed(2),
            session:mins<630?'OPEN':mins<840?'MID':'AFT',
            dayTrend:dt,
          });
        }
      }
    }
    console.log(`${tc} trades`);
    await new Promise(r=>setTimeout(r,200));
  }

  // === ANALYSIS ===
  console.log('\n'+'='.repeat(90));
  console.log('ANALISIS DE 4 SEMANAS — QUÉ TIENEN EN COMUN LOS WINNERS');
  console.log('='.repeat(90));

  const wins=allTrades.filter(t=>t.result==='WIN');
  const losses=allTrades.filter(t=>t.result==='LOSS');
  const bes=allTrades.filter(t=>t.result==='BE');

  console.log(`\nTotal: ${allTrades.length} | W:${wins.length} L:${losses.length} BE:${bes.length}`);

  function pct(arr,fn){return arr.length?((arr.filter(fn).length/arr.length)*100).toFixed(0)+'%':'N/A';}

  console.log(`\n${'Factor'.padEnd(25)} ${'WINS'.padEnd(10)} ${'LOSSES'.padEnd(10)} ${'BE'.padEnd(10)} Diferencia`);
  console.log('-'.repeat(70));

  const factors=[
    ['EMA10 aligned',t=>t.emaAligned],
    ['VWAP aligned',t=>t.vwapAligned===true],
    ['EMA+VWAP both',t=>t.emaAligned&&t.vwapAligned===true],
    ['SPY confirms',t=>t.spyConv],
    ['VIX confirms',t=>t.vixConv],
    ['SPY+VIX both',t=>t.spyConv&&t.vixConv],
    ['Trend aligned',t=>t.trendAligned],
    ['High volume (>1.5x)',t=>t.relVol>1.5],
    ['OPEN session',t=>t.session==='OPEN'],
    ['MID session',t=>t.session==='MID'],
    ['AFT session',t=>t.session==='AFT'],
    ['Breakout (BRK)',t=>t.type==='BRK'],
    ['Rejection (REJ)',t=>t.type==='REJ'],
    ['ALL filters ok',t=>t.emaAligned&&t.vwapAligned===true&&t.spyConv&&t.vixConv&&t.trendAligned],
  ];

  for(const [name,fn] of factors){
    const wp=pct(wins,fn),lp=pct(losses,fn),bp=pct(bes,fn);
    const wd=wins.filter(fn).length,ld=losses.filter(fn).length;
    const diff=wd&&ld?((wd/(wd+ld))*100).toFixed(0)+'% WR':'—';
    console.log(`${name.padEnd(25)} ${wp.padEnd(10)} ${lp.padEnd(10)} ${bp.padEnd(10)} ${diff}`);
  }

  // Filter: ALL filters ok
  console.log('\n'+'='.repeat(90));
  console.log('TRADES CON TODOS LOS FILTROS OK (ema+vwap+spy+vix+trend)');
  console.log('='.repeat(90));
  const perfect=allTrades.filter(t=>t.emaAligned&&t.vwapAligned===true&&t.spyConv&&t.vixConv&&t.trendAligned);
  const pw=perfect.filter(t=>t.result==='WIN').length;
  const pl=perfect.filter(t=>t.result==='LOSS').length;
  const pb=perfect.filter(t=>t.result==='BE').length;
  const ppnl=perfect.reduce((s,t)=>s+t.pnl,0);
  const pgw=perfect.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const pgl=Math.abs(perfect.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
  const ppf=pgl>0?(pgw/pgl).toFixed(2):'∞';
  const pdays=new Set(perfect.map(t=>t.date)).size;
  console.log(`Trades: ${perfect.length} | W:${pw} L:${pl} BE:${pb} | PF:${ppf} | PnL:$${ppnl.toFixed(2)} | ${pdays?((perfect.length/pdays).toFixed(1)):0}/day`);

  if(perfect.length<=40){
    console.log(`\n${'Date'.padEnd(11)} ${'Time'.padEnd(9)} ${'Tkr'.padEnd(5)} ${'Dir'.padEnd(5)} ${'Type'.padEnd(4)} ${'Lvl'.padEnd(4)} ${'Entry'.padEnd(8)} ${'PnL'.padEnd(8)} ${'Res'.padEnd(6)} ${'MaxF'.padEnd(6)} ${'Vol'.padEnd(5)} Ses`);
    for(const t of perfect)
      console.log(`${t.date.padEnd(11)} ${t.time.padEnd(9)} ${t.ticker.padEnd(5)} ${t.dir.padEnd(5)} ${t.type.padEnd(4)} ${t.level.padEnd(4)} $${String(t.entry).padEnd(7)} ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${t.result.padEnd(6)} $${t.maxFav.toFixed(2).padStart(5)} ${t.relVol.toFixed(1).padStart(4)}x ${t.session}`);
  }

  // Best single filter combos
  console.log('\n'+'='.repeat(90));
  console.log('MEJORES COMBINACIONES DE FILTROS');
  console.log('='.repeat(90));

  const combos=[
    ['SPY+VIX only',t=>t.spyConv&&t.vixConv],
    ['EMA+SPY+VIX',t=>t.emaAligned&&t.spyConv&&t.vixConv],
    ['VWAP+SPY+VIX',t=>t.vwapAligned===true&&t.spyConv&&t.vixConv],
    ['EMA+VWAP+SPY+VIX',t=>t.emaAligned&&t.vwapAligned===true&&t.spyConv&&t.vixConv],
    ['Trend+SPY+VIX',t=>t.trendAligned&&t.spyConv&&t.vixConv],
    ['ALL',t=>t.emaAligned&&t.vwapAligned===true&&t.spyConv&&t.vixConv&&t.trendAligned],
    ['OPEN+SPY+VIX',t=>t.session==='OPEN'&&t.spyConv&&t.vixConv],
    ['OPEN+EMA+SPY+VIX',t=>t.session==='OPEN'&&t.emaAligned&&t.spyConv&&t.vixConv],
    ['BRK+SPY+VIX',t=>t.type==='BRK'&&t.spyConv&&t.vixConv],
    ['BRK+EMA+SPY+VIX',t=>t.type==='BRK'&&t.emaAligned&&t.spyConv&&t.vixConv],
  ];

  for(const [name,fn] of combos){
    const filtered=allTrades.filter(fn);
    const w=filtered.filter(t=>t.result==='WIN').length;
    const l=filtered.filter(t=>t.result==='LOSS').length;
    const b=filtered.filter(t=>t.result==='BE').length;
    const pnl=filtered.reduce((s,t)=>s+t.pnl,0);
    const gw=filtered.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gl=Math.abs(filtered.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    const pf=gl>0?(gw/gl).toFixed(2):gw>0?'∞':'0';
    const nlr=filtered.length?((1-l/filtered.length)*100).toFixed(0):'0';
    const days=new Set(filtered.map(t=>t.date)).size;
    console.log(`${name.padEnd(25)} ${String(filtered.length).padStart(3)} trades | ${String(w).padStart(2)}W ${String(l).padStart(2)}L ${String(b).padStart(2)}BE | NLR ${nlr.padStart(2)}% | PF ${pf.padStart(5)} | $${pnl.toFixed(2).padStart(7)} | ${days?(filtered.length/days).toFixed(1):'0'}/day`);
  }
}

run().catch(console.error);
