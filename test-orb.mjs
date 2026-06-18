// ORB 5min: Opening Range Breakout
// First 5min candle (9:30-9:35) defines the range
// Breakout above = CALL, below = PUT
// Test different configs: TP, SL, time filters, convergence

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

async function fetch1minMonth(ticker){
  const now=Math.floor(Date.now()/1000);const chunks=[];
  for(let i=0;i<4;i++){const end=now-i*7*86400,start=end-7*86400;const d=await fetchChart(ticker,'1m',null,start,end);if(d&&d.timestamps.length>0)chunks.unshift(d);await new Promise(r=>setTimeout(r,300));}
  if(!chunks.length)return null;const m={timestamps:[],closes:[]};const seen=new Set();
  for(const c of chunks)for(let i=0;i<c.timestamps.length;i++){if(!seen.has(c.timestamps[i])){seen.add(c.timestamps[i]);m.timestamps.push(c.timestamps[i]);m.closes.push(c.closes[i]);}}return m;}

function calcEMA(a,p){if(!a||a.length<p)return[];const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}
function checkIdx(data,ts,dir,inv){let idx=-1;for(let i=data.timestamps.length-1;i>=0;i--){if(data.timestamps[i]<=ts){idx=i;break;}}if(idx<3)return false;const c=data.closes;if(c[idx]==null||c[idx-1]==null||c[idx-3]==null)return false;const p=c[idx],t3=p-c[idx-3],t1=p-c[idx-1],th=p*0.00003;if(inv)return dir==='CALL'?(t3<-th&&t1<=0):(t3>th&&t1>=0);return dir==='CALL'?(t3>th&&t1>=0):(t3<-th&&t1<=0);}

function simulateTrade(dir,entry,sl,tp,data,si,ei){
  let maxFav=0;
  for(let j=si+1;j<=ei;j++){const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){maxFav=Math.max(maxFav,h-entry);if(l<=sl)return{pnl:sl-entry,type:'STOP',maxFav,exitIdx:j};if(h>=tp)return{pnl:tp-entry,type:'TARGET',maxFav,exitIdx:j};}
    else{maxFav=Math.max(maxFav,entry-l);if(h>=sl)return{pnl:entry-sl,type:'STOP',maxFav,exitIdx:j};if(l<=tp)return{pnl:entry-tp,type:'TARGET',maxFav,exitIdx:j};}}
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD',maxFav,exitIdx:ei};}

async function run(){
  console.log('Loading SPY+VIX 1min...');
  const [spy1m,vix1m]=await Promise.all([fetch1minMonth('SPY'),fetch1minMonth('^VIX')]);

  const configs = [
    // ORB candles (how many 5min candles define the range), SL multiplier, TP multiplier, with/without convergence
    // SL = range * slMult, TP = range * tpMult
    {label:'ORB 1x5min SL=range TP=2x',  orbCandles:1, slMult:1.0, tpMult:2.0, conv:false, trend:true},
    {label:'ORB 1x5min SL=range TP=1.5x', orbCandles:1, slMult:1.0, tpMult:1.5, conv:false, trend:true},
    {label:'ORB 1x5min SL=range TP=1x',   orbCandles:1, slMult:1.0, tpMult:1.0, conv:false, trend:true},
    {label:'ORB 1x5min SL=0.5x TP=1x',    orbCandles:1, slMult:0.5, tpMult:1.0, conv:false, trend:true},
    {label:'ORB 1x5min SL=0.5x TP=1.5x',  orbCandles:1, slMult:0.5, tpMult:1.5, conv:false, trend:true},
    {label:'ORB 2x5min SL=range TP=2x',   orbCandles:2, slMult:1.0, tpMult:2.0, conv:false, trend:true},
    {label:'ORB 2x5min SL=0.5x TP=1x',    orbCandles:2, slMult:0.5, tpMult:1.0, conv:false, trend:true},
    {label:'ORB 3x5min SL=range TP=2x',   orbCandles:3, slMult:1.0, tpMult:2.0, conv:false, trend:true},
    {label:'ORB 3x5min SL=0.5x TP=1x',    orbCandles:3, slMult:0.5, tpMult:1.0, conv:false, trend:true},
    // With SPY+VIX convergence
    {label:'ORB 1x5min TP=2x +SPY+VIX',   orbCandles:1, slMult:1.0, tpMult:2.0, conv:true, trend:true},
    {label:'ORB 1x5min TP=1.5x +SPY+VIX', orbCandles:1, slMult:1.0, tpMult:1.5, conv:true, trend:true},
    {label:'ORB 2x5min TP=2x +SPY+VIX',   orbCandles:2, slMult:1.0, tpMult:2.0, conv:true, trend:true},
    {label:'ORB 3x5min TP=1.5x +SPY+VIX', orbCandles:3, slMult:1.0, tpMult:1.5, conv:true, trend:true},
    // Fixed SL/TP
    {label:'ORB 1x5min SL=$1 TP=$2',      orbCandles:1, slFixed:1.0, tpFixed:2.0, conv:false, trend:true},
    {label:'ORB 1x5min SL=$1 TP=$2 +conv', orbCandles:1, slFixed:1.0, tpFixed:2.0, conv:true, trend:true},
    // No trend filter
    {label:'ORB 1x5min TP=2x NO trend',   orbCandles:1, slMult:1.0, tpMult:2.0, conv:false, trend:false},
  ];

  const results = {};
  for(const cfg of configs) results[cfg.label]=[];

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

      // Find first N candles at 9:30+ (regular hours)
      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=570&&m<960;});
      if(regIdx.length<15)continue;

      for(const cfg of configs){
        const orbEnd=Math.min(cfg.orbCandles, regIdx.length-1);
        // ORB range = high/low of first N candles
        let orbH=-Infinity, orbL=Infinity;
        for(let j=0;j<orbEnd;j++){
          const ci=regIdx[j];
          if(data5m.highs[ci]!=null&&data5m.highs[ci]>orbH)orbH=data5m.highs[ci];
          if(data5m.lows[ci]!=null&&data5m.lows[ci]<orbL)orbL=data5m.lows[ci];
        }
        const orbRange=orbH-orbL;
        if(orbRange<0.05||orbRange>30)continue;

        let touchedUp=false,touchedDown=false;

        // Walk candles AFTER ORB period
        for(let ri=orbEnd;ri<regIdx.length-2;ri++){
          if(touchedUp&&touchedDown)break;
          const ci=regIdx[ri];
          const price=data5m.closes[ci],h=data5m.highs[ci],l=data5m.lows[ci];
          if(!price||!h||!l)continue;
          const cts=data5m.timestamps[ci];
          const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

          // Breakout UP
          if(!touchedUp&&h>orbH){
            let dir='CALL';
            if(cfg.trend&&dt==='DOWN')dir=null;
            if(cfg.conv&&dir&&(!checkIdx(spy1m,cts,dir,false)||!checkIdx(vix1m,cts,dir,true)))dir=null;

            if(dir){
              touchedUp=true;
              const entry=+orbH.toFixed(2); // enter at the breakout level
              let sl,tp;
              if(cfg.slFixed!=null){sl=entry-cfg.slFixed;tp=entry+cfg.tpFixed;}
              else{sl=entry-orbRange*cfg.slMult;tp=entry+orbRange*cfg.tpMult;}
              sl=+sl.toFixed(2);tp=+tp.toFixed(2);
              const stopDist=entry-sl;
              if(stopDist/entry>0.02)continue; // skip if stop >2%

              const eod=regIdx[regIdx.length-1];
              const res=simulateTrade('CALL',entry,sl,tp,data5m,ci,eod);
              const exitTime=new Date(data5m.timestamps[res.exitIdx]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

              results[cfg.label].push({
                date:dk,time,exitTime,ticker,dir:'CALL',
                orbH:+orbH.toFixed(2),orbL:+orbL.toFixed(2),orbRange:+orbRange.toFixed(2),
                entry,sl,tp,stopDist:+stopDist.toFixed(2),
                pnl:+res.pnl.toFixed(2),exitType:res.type,
                result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
                maxFav:+res.maxFav.toFixed(2),dayTrend:dt,
              });
              if(cfg.label.includes('1x5min')&&cfg.tpMult===2.0&&!cfg.conv)tc++;
            }
          }

          // Breakout DOWN
          if(!touchedDown&&l<orbL){
            let dir='PUT';
            if(cfg.trend&&dt==='UP')dir=null;
            if(cfg.conv&&dir&&(!checkIdx(spy1m,cts,dir,false)||!checkIdx(vix1m,cts,dir,true)))dir=null;

            if(dir){
              touchedDown=true;
              const entry=+orbL.toFixed(2);
              let sl,tp;
              if(cfg.slFixed!=null){sl=entry+cfg.slFixed;tp=entry-cfg.tpFixed;}
              else{sl=entry+orbRange*cfg.slMult;tp=entry-orbRange*cfg.tpMult;}
              sl=+sl.toFixed(2);tp=+tp.toFixed(2);
              const stopDist=sl-entry;
              if(stopDist/entry>0.02)continue;

              const eod=regIdx[regIdx.length-1];
              const res=simulateTrade('PUT',entry,sl,tp,data5m,ci,eod);
              const exitTime=new Date(data5m.timestamps[res.exitIdx]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

              results[cfg.label].push({
                date:dk,time,exitTime,ticker,dir:'PUT',
                orbH:+orbH.toFixed(2),orbL:+orbL.toFixed(2),orbRange:+orbRange.toFixed(2),
                entry,sl,tp,stopDist:+stopDist.toFixed(2),
                pnl:+res.pnl.toFixed(2),exitType:res.type,
                result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
                maxFav:+res.maxFav.toFixed(2),dayTrend:dt,
              });
            }
          }
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  const MULT=0.50*2*100/2;

  console.log('\n'+'='.repeat(120));
  console.log('ORB 5min — Comparación de configuraciones (1 mes, 10 tickers)');
  console.log('='.repeat(120));

  const sorted=Object.entries(results)
    .map(([label,trades])=>{
      const w=trades.filter(t=>t.result==='WIN').length;const l=trades.filter(t=>t.result==='LOSS').length;const b=trades.filter(t=>t.result==='BE').length;
      const pnl=trades.reduce((s,t)=>s+t.pnl,0);const gw=trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);const gl=Math.abs(trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
      const days=new Set(trades.map(t=>t.date)).size;
      return{label,n:trades.length,w,l,b,pnl,pf:gl>0?gw/gl:gw>0?999:0,days,cpnl:pnl*MULT,trades};})
    .sort((a,b)=>b.pf-a.pf);

  for(const s of sorted){
    const wr=s.n?((s.w/s.n)*100).toFixed(0):'0';
    console.log(`\n${s.label}`);
    console.log(`  ${s.n} trades (${(s.n/s.days).toFixed(1)}/d) | ${s.w}W ${s.l}L ${s.b}BE | WR ${wr}% | PF ${s.pf.toFixed(2)} | $${s.cpnl.toFixed(0)} ($${(s.cpnl/s.days).toFixed(0)}/d)`);
  }

  // Show trades for best PF config
  const best=sorted[0];
  if(best&&best.trades.length>0){
    console.log('\n\n'+'='.repeat(130));
    console.log(`MEJOR: ${best.label}`);
    console.log('='.repeat(130));
    console.log(`\n${'Fecha'.padEnd(11)} ${'Hora'.padEnd(9)} ${'Exit'.padEnd(9)} ${'Tkr'.padEnd(6)} ${'Dir'.padEnd(5)} ${'ORB H'.padEnd(9)} ${'ORB L'.padEnd(9)} ${'Rng'.padEnd(7)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP'.padEnd(9)} ${'PnL'.padEnd(8)} ${'$2c'.padEnd(7)} Res`);
    console.log('-'.repeat(125));
    best.trades.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
    for(const t of best.trades){
      const cp=t.pnl*MULT;const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
      console.log(`${t.date.padEnd(11)} ${t.time.padEnd(9)} ${t.exitTime.padEnd(9)} ${t.ticker.padEnd(6)} ${t.dir.padEnd(5)} $${String(t.orbH).padEnd(8)} $${String(t.orbL).padEnd(8)} $${t.orbRange.toFixed(1).padStart(5)} $${String(t.entry).padEnd(8)} $${String(t.sl).padEnd(8)} $${String(t.tp).padEnd(8)} ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${(cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(4)} ${icon}${t.result}`);
    }
  }

  // CALL only vs PUT only for best config label base
  console.log('\n--- CALL vs PUT (ORB 1x5min TP=2x) ---');
  const base=results['ORB 1x5min SL=range TP=2x']||[];
  for(const dir of ['CALL','PUT']){
    const dt=base.filter(t=>t.dir===dir);if(!dt.length)continue;
    const dw=dt.filter(t=>t.result==='WIN').length;const dl=dt.filter(t=>t.result==='LOSS').length;
    const dp=dt.reduce((s,t)=>s+t.pnl,0);
    const gw=dt.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);const gl=Math.abs(dt.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    console.log(`  ${dir}: ${dt.length} trades | ${dw}W ${dl}L | WR ${((dw/dt.length)*100).toFixed(0)}% | PF ${gl>0?(gw/gl).toFixed(2):'∞'} | $${(dp*MULT).toFixed(0)}`);
  }
}

run().catch(console.error);
