// Test different R:R ratios to maximize WIN RATE
// Same strategy: Trend + SPY+VIX + levels + merge

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range,p1=null,p2=null){
  let url;if(p1&&p2)url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&period1=${p1}&period2=${p2}&includePrePost=true`;
  else url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

async function fetch1minMonth(ticker){
  const now=Math.floor(Date.now()/1000);const chunks=[];
  for(let i=0;i<4;i++){const end=now-i*7*86400,start=end-7*86400;const d=await fetchChart(ticker,'1m',null,start,end);if(d&&d.timestamps.length>0)chunks.unshift(d);await new Promise(r=>setTimeout(r,300));}
  if(!chunks.length)return null;const m={timestamps:[],closes:[]};const seen=new Set();
  for(const c of chunks)for(let i=0;i<c.timestamps.length;i++){if(!seen.has(c.timestamps[i])){seen.add(c.timestamps[i]);m.timestamps.push(c.timestamps[i]);m.closes.push(c.closes[i]);}}return m;}

function getStop(p){return p<100?0.5:p<250?1:p<400?1.5:p<550?2:2.5;}
function calcEMA(a,p){const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}
function checkIdx(data,ts,dir,inv){let idx=-1;for(let i=data.timestamps.length-1;i>=0;i--){if(data.timestamps[i]<=ts){idx=i;break;}}if(idx<3)return false;const c=data.closes;if(c[idx]==null||c[idx-1]==null||c[idx-3]==null)return false;const p=c[idx],t3=p-c[idx-3],t1=p-c[idx-1],th=p*0.00003;if(inv)return dir==='CALL'?(t3<-th&&t1<=0):(t3>th&&t1>=0);return dir==='CALL'?(t3>th&&t1>=0):(t3<-th&&t1<=0);}
function mergeLevels(levels){const pri={PDH:3,PDL:3,PMH:2,PML:2};const sorted=[...levels].sort((a,b)=>a.price-b.price);const merged=[],used=new Set();for(let i=0;i<sorted.length;i++){if(used.has(i))continue;let best=sorted[i];for(let j=i+1;j<sorted.length;j++){if(used.has(j))continue;if(Math.abs(sorted[j].price-best.price)/best.price<0.005){if((pri[sorted[j].name]||0)>(pri[best.name]||0)){used.add(i);best=sorted[j];}used.add(j);}}merged.push(best);}return merged;}

// Simulate with configurable target multiplier and BE multiplier
function simulateTrade(dir, entry, sd, targetMult, beMult, data, si, ei) {
  const tgt = dir==='CALL' ? entry + sd*targetMult : entry - sd*targetMult;
  const beLevel = dir==='CALL' ? entry + sd*beMult : entry - sd*beMult;
  let stop = dir==='CALL' ? entry-sd : entry+sd;
  let be = false;
  for (let j=si+1; j<=ei; j++) {
    const h=data.highs[j], l=data.lows[j]; if(h==null||l==null)continue;
    if (dir==='CALL') {
      if (h >= beLevel && !be) { stop=entry; be=true; }
      if (l <= stop) return { pnl: stop-entry, type: be?'BE':'STOP' };
      if (h >= tgt) return { pnl: tgt-entry, type: 'TARGET' };
    } else {
      if (entry-l >= sd*beMult && !be) { stop=entry; be=true; }
      if (h >= stop) return { pnl: entry-stop, type: be?'BE':'STOP' };
      if (l <= tgt) return { pnl: entry-tgt, type: 'TARGET' };
    }
  }
  const ep=data.closes[ei]||entry;
  return { pnl: dir==='CALL'?ep-entry:entry-ep, type:'EOD' };
}

async function run() {
  console.log('Loading...');
  const [spy1m,vix1m] = await Promise.all([fetch1minMonth('SPY'), fetch1minMonth('^VIX')]);

  // Collect all signal points (before trade sim)
  const signals = [];

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);
    const [data5m, dailyData] = await Promise.all([fetchChart(ticker,'5m','1mo'), fetchChart(ticker,'1d','3mo')]);
    if (!data5m || data5m.timestamps.length<50) { console.log('skip'); continue; }
    const days=groupByDay(data5m.timestamps); const dayKeys=Object.keys(days).sort();
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[]; const dTs=dailyData?dailyData.timestamps:[]; const dEma10=calcEMA(dCloses,10);
    function getDayTrend(dk){if(dCloses.length<12)return'NEUTRAL';const ts=new Date(dk+'T12:00:00').getTime()/1000;let idx=-1;for(let i=dTs.length-1;i>=0;i--){if(dTs[i]<=ts+86400){idx=i;break;}}if(idx<10)return'NEUTRAL';if(dCloses[idx]>dEma10[idx]&&dCloses[idx-1]>dCloses[idx-2])return'UP';if(dCloses[idx]<dEma10[idx]&&dCloses[idx-1]<dCloses[idx-2])return'DOWN';return'NEUTRAL';}

    let tc=0;
    for (let di=1; di<dayKeys.length; di++) {
      const dk=dayKeys[di],pdk=dayKeys[di-1]; const indices=days[dk],prevIndices=days[pdk];
      if(!prevIndices||indices.length<15)continue;
      let rawLevels=[]; let pdh=-Infinity,pdl=Infinity;
      for(const pi of prevIndices){const m=getMinutesET(data5m.timestamps[pi]);if(m>=570&&m<960){if(data5m.highs[pi]!=null&&data5m.highs[pi]>pdh)pdh=data5m.highs[pi];if(data5m.lows[pi]!=null&&data5m.lows[pi]<pdl)pdl=data5m.lows[pi];}}
      if(pdh!==-Infinity){rawLevels.push({name:'PDH',price:+pdh.toFixed(2)});rawLevels.push({name:'PDL',price:+pdl.toFixed(2)});}
      let pmh=-Infinity,pml=Infinity,pmc=0;
      for(const ci of indices){const m=getMinutesET(data5m.timestamps[ci]);if(m>=240&&m<570){if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];pmc++;}}
      if(pmc>=3&&pmh!==-Infinity){rawLevels.push({name:'PMH',price:+pmh.toFixed(2)});rawLevels.push({name:'PML',price:+pml.toFixed(2)});}
      const levels=mergeLevels(rawLevels); if(!levels.length)continue;
      const dt=getDayTrend(dk); const touched={};
      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<955;});

      for(let ri=1;ri<regIdx.length;ri++){
        const ci=regIdx[ri],pci=regIdx[ri-1];
        const price=data5m.closes[ci],h=data5m.highs[ci],l=data5m.lows[ci],o=data5m.opens[ci],c=data5m.closes[ci];
        if(!price||!h||!l||!o)continue;
        const body=Math.abs(c-o),wU=h-Math.max(c,o),wD=Math.min(c,o)-l;
        const sd=getStop(price);const pH=data5m.highs[pci],pL=data5m.lows[pci];
        const cts=data5m.timestamps[ci];

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
          touched[tk]=true; tc++;

          signals.push({ date:dk, ticker, dir, type, level:lv.name, price, sd, ci, eod:regIdx[regIdx.length-1], data5m });
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  console.log(`\nTotal signals: ${signals.length}`);

  // Test different R:R ratios
  const DELTA=0.50, CONTRACTS=2, MULT=DELTA*CONTRACTS*100/CONTRACTS;

  console.log('\n'+'='.repeat(110));
  console.log('WIN RATE vs R:R RATIO — Misma estrategia, diferente target');
  console.log('2 contratos, delta 0.50');
  console.log('='.repeat(110));

  const configs = [
    { target: 1.0, be: 0.5, label: '1:1 (TP=1x stop, BE=0.5x)' },
    { target: 1.5, be: 0.75, label: '1:1.5 (TP=1.5x, BE=0.75x)' },
    { target: 2.0, be: 1.0, label: '1:2 (TP=2x, BE=1x)' },
    { target: 2.5, be: 1.0, label: '1:2.5 (TP=2.5x, BE=1x)' },
    { target: 3.0, be: 1.0, label: '1:3 (TP=3x, BE=1x) ← actual' },
    { target: 4.0, be: 1.5, label: '1:4 (TP=4x, BE=1.5x)' },
  ];

  for (const cfg of configs) {
    const trades = signals.map(s => {
      const res = simulateTrade(s.dir, s.price, s.sd, cfg.target, cfg.be, s.data5m, s.ci, s.eod);
      return { ...s, pnl: +res.pnl.toFixed(2), exitType: res.type, result: res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS' };
    });

    const w=trades.filter(t=>t.result==='WIN').length;
    const l=trades.filter(t=>t.result==='LOSS').length;
    const b=trades.filter(t=>t.result==='BE').length;
    const pnl=trades.reduce((s,t)=>s+t.pnl,0);
    const cpnl=pnl*MULT;
    const gw=trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gl=Math.abs(trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    const pf=gl>0?(gw/gl).toFixed(2):'∞';
    const days=new Set(trades.map(t=>t.date)).size;
    const wr=((w/trades.length)*100).toFixed(0);
    const nlr=((1-l/trades.length)*100).toFixed(0);

    console.log(`\n${cfg.label}`);
    console.log(`  ${trades.length} trades | ${w}W ${l}L ${b}BE | WR ${wr}% | NLR ${nlr}% | PF ${pf} | Stock $${pnl.toFixed(2)} | Contracts $${cpnl.toFixed(0)} | $${(cpnl/days).toFixed(0)}/day`);

    // With max 3/day
    const byDay={};
    trades.forEach(t=>{if(!byDay[t.date])byDay[t.date]=[];byDay[t.date].push(t);});
    const taken3=[];
    for(const [day,dt] of Object.entries(byDay))taken3.push(...dt.slice(0,3));
    const w3=taken3.filter(t=>t.result==='WIN').length;
    const l3=taken3.filter(t=>t.result==='LOSS').length;
    const b3=taken3.filter(t=>t.result==='BE').length;
    const pnl3=taken3.reduce((s,t)=>s+t.pnl,0);
    const cpnl3=pnl3*MULT;
    const gw3=taken3.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gl3=Math.abs(taken3.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    const pf3=gl3>0?(gw3/gl3).toFixed(2):'∞';
    const wr3=((w3/taken3.length)*100).toFixed(0);

    console.log(`  Max 3/day: ${taken3.length} trades | ${w3}W ${l3}L ${b3}BE | WR ${wr3}% | PF ${pf3} | $${cpnl3.toFixed(0)} ($${(cpnl3/days).toFixed(0)}/day)`);
  }
}

run().catch(console.error);
