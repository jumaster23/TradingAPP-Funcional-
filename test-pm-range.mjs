// TEST: Premarket range $2-5 breakouts + SPY+VIX convergence
// Hypothesis: tight PM range → explosive breakout on open

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

function getStop(p){return p<100?0.5:p<250?1:p<400?1.5:p<550?2:2.5;}
function calcEMA(a,p){if(!a||a.length<p)return[];const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}
function checkIdx(data,ts,dir,inv){let idx=-1;for(let i=data.timestamps.length-1;i>=0;i--){if(data.timestamps[i]<=ts){idx=i;break;}}if(idx<3)return false;const c=data.closes;if(c[idx]==null||c[idx-1]==null||c[idx-3]==null)return false;const p=c[idx],t3=p-c[idx-3],t1=p-c[idx-1],th=p*0.00003;if(inv)return dir==='CALL'?(t3<-th&&t1<=0):(t3>th&&t1>=0);return dir==='CALL'?(t3>th&&t1>=0):(t3<-th&&t1<=0);}

function simulateTrade(dir,entry,sd,tgtMult,data,si,ei){
  const tgt=dir==='CALL'?entry+sd*tgtMult:entry-sd*tgtMult;
  let stop=dir==='CALL'?entry-sd:entry+sd,be=false,maxFav=0;
  for(let j=si+1;j<=ei;j++){const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){maxFav=Math.max(maxFav,h-entry);if(h>=entry+sd&&!be){stop=entry;be=true;}if(l<=stop)return{pnl:stop-entry,type:be?'BE':'STOP',maxFav};if(h>=tgt)return{pnl:tgt-entry,type:'TARGET',maxFav};}
    else{maxFav=Math.max(maxFav,entry-l);if(entry-l>=sd&&!be){stop=entry;be=true;}if(h>=stop)return{pnl:entry-stop,type:be?'BE':'STOP',maxFav};if(l<=tgt)return{pnl:entry-tgt,type:'TARGET',maxFav};}}
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD',maxFav};}

async function run(){
  console.log('Loading SPY+VIX 1min...');
  const [spy1m,vix1m]=await Promise.all([fetch1minMonth('SPY'),fetch1minMonth('^VIX')]);

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

      // Calculate PMH/PML from premarket candles (4:00-9:30 ET)
      let pmh=-Infinity,pml=Infinity,pmc=0;
      for(const ci of indices){
        const m=getMinutesET(data5m.timestamps[ci]);
        if(m>=240&&m<570){
          if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];
          if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];
          pmc++;
        }
      }
      if(pmc<3||pmh===-Infinity)continue;

      const pmRange=pmh-pml;
      const pmRangePct=(pmRange/pmh)*100;

      // Regular hours candles
      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<955;});
      if(regIdx.length<10)continue;

      let touchedH=false,touchedL=false;

      for(let ri=1;ri<regIdx.length-3;ri++){
        const ci=regIdx[ri],pci=regIdx[ri-1];
        const price=data5m.closes[ci],h=data5m.highs[ci],l=data5m.lows[ci];
        if(!price||!h||!l)continue;
        const prevH=data5m.highs[pci],prevL=data5m.lows[pci];
        const sd=getStop(price);
        const cts=data5m.timestamps[ci];
        const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        // Breakout PMH (first touch only)
        if(!touchedH&&h>pmh&&prevH!=null&&prevH<=pmh){
          const dir='CALL';
          if(dir==='CALL'&&dt==='DOWN')continue;
          if(checkIdx(spy1m,cts,dir,false)&&checkIdx(vix1m,cts,dir,true)){
            touchedH=true;
            const eod=regIdx[regIdx.length-1];
            for(const tgt of [2,3]){
              const res=simulateTrade(dir,price,sd,tgt,data5m,ci,eod);
              allTrades.push({
                date:dk,time,ticker,dir:'CALL',level:'PMH',levelPrice:+pmh.toFixed(2),
                entry:+price.toFixed(2),pnl:+res.pnl.toFixed(2),exitType:res.type,
                result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
                maxFav:+res.maxFav.toFixed(2),
                pmRange:+pmRange.toFixed(2),pmRangePct:+pmRangePct.toFixed(2),
                dayTrend:dt,target:`1:${tgt}`,
              });
            }
            tc++;
          }
        }

        // Breakout PML (first touch only)
        if(!touchedL&&l<pml&&prevL!=null&&prevL>=pml){
          const dir='PUT';
          if(dir==='PUT'&&dt==='UP')continue;
          if(checkIdx(spy1m,cts,dir,false)&&checkIdx(vix1m,cts,dir,true)){
            touchedL=true;
            const eod=regIdx[regIdx.length-1];
            for(const tgt of [2,3]){
              const res=simulateTrade(dir,price,sd,tgt,data5m,ci,eod);
              allTrades.push({
                date:dk,time,ticker,dir:'PUT',level:'PML',levelPrice:+pml.toFixed(2),
                entry:+price.toFixed(2),pnl:+res.pnl.toFixed(2),exitType:res.type,
                result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
                maxFav:+res.maxFav.toFixed(2),
                pmRange:+pmRange.toFixed(2),pmRangePct:+pmRangePct.toFixed(2),
                dayTrend:dt,target:`1:${tgt}`,
              });
            }
            tc++;
          }
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  const MULT=0.50*2*100/2;

  // Analyze by PM range buckets
  console.log('\n'+'='.repeat(100));
  console.log('PM RANGE ANALYSIS — ¿Cuál rango premarket da mejores trades?');
  console.log('Solo breakouts PMH/PML con SPY+VIX + tendencia + first-touch');
  console.log('='.repeat(100));

  const t2=allTrades.filter(t=>t.target==='1:2');
  const t3=allTrades.filter(t=>t.target==='1:3');

  // By range buckets
  const buckets=[
    {label:'$0-2 (muy estrecho)',min:0,max:2},
    {label:'$2-3',min:2,max:3},
    {label:'$3-5',min:3,max:5},
    {label:'$2-5 (tu rango)',min:2,max:5},
    {label:'$5-8',min:5,max:8},
    {label:'$8-15',min:8,max:15},
    {label:'$15+ (muy amplio)',min:15,max:999},
  ];

  console.log('\n--- TARGET 1:2 ---');
  for(const b of buckets){
    const bt=t2.filter(t=>t.pmRange>=b.min&&t.pmRange<b.max);
    if(!bt.length)continue;
    const w=bt.filter(t=>t.result==='WIN').length;
    const l=bt.filter(t=>t.result==='LOSS').length;
    const be=bt.filter(t=>t.result==='BE').length;
    const pnl=bt.reduce((s,t)=>s+t.pnl,0);
    const gw=bt.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gl=Math.abs(bt.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    const pf=gl>0?(gw/gl).toFixed(2):'∞';
    console.log(`  ${b.label.padEnd(22)} ${String(bt.length).padStart(3)} trades | ${String(w).padStart(2)}W ${String(l).padStart(2)}L ${String(be).padStart(2)}BE | WR ${((w/bt.length)*100).toFixed(0).padStart(2)}% | PF ${pf.padStart(5)} | $${(pnl*MULT).toFixed(0).padStart(6)}`);
  }

  console.log('\n--- TARGET 1:3 ---');
  for(const b of buckets){
    const bt=t3.filter(t=>t.pmRange>=b.min&&t.pmRange<b.max);
    if(!bt.length)continue;
    const w=bt.filter(t=>t.result==='WIN').length;
    const l=bt.filter(t=>t.result==='LOSS').length;
    const be=bt.filter(t=>t.result==='BE').length;
    const pnl=bt.reduce((s,t)=>s+t.pnl,0);
    const gw=bt.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gl=Math.abs(bt.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    const pf=gl>0?(gw/gl).toFixed(2):'∞';
    console.log(`  ${b.label.padEnd(22)} ${String(bt.length).padStart(3)} trades | ${String(w).padStart(2)}W ${String(l).padStart(2)}L ${String(be).padStart(2)}BE | WR ${((w/bt.length)*100).toFixed(0).padStart(2)}% | PF ${pf.padStart(5)} | $${(pnl*MULT).toFixed(0).padStart(6)}`);
  }

  // PMH vs PML
  console.log('\n--- PMH (breakout UP) vs PML (breakout DOWN) — target 1:2 ---');
  for(const lv of ['PMH','PML']){
    const lt=t2.filter(t=>t.level===lv);
    if(!lt.length)continue;
    const w=lt.filter(t=>t.result==='WIN').length;
    const l=lt.filter(t=>t.result==='LOSS').length;
    const pnl=lt.reduce((s,t)=>s+t.pnl,0);
    const gw=lt.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gl=Math.abs(lt.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    console.log(`  ${lv}: ${lt.length} trades | ${w}W ${l}L | WR ${((w/lt.length)*100).toFixed(0)}% | PF ${gl>0?(gw/gl).toFixed(2):'∞'} | $${(pnl*MULT).toFixed(0)}`);
  }

  // Show all trades for PM range $2-5
  const sweet=t2.filter(t=>t.pmRange>=2&&t.pmRange<5);
  console.log('\n\n'+'='.repeat(120));
  console.log(`TRADES CON PM RANGE $2-5 — Target 1:2 (${sweet.length} trades)`);
  console.log('='.repeat(120));
  console.log(`\n${'Fecha'.padEnd(11)} ${'Hora'.padEnd(9)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Nivel'.padEnd(4)} ${'LvlPr'.padEnd(9)} ${'Entry'.padEnd(9)} ${'PnL'.padEnd(8)} ${'$2c'.padEnd(7)} ${'Res'.padEnd(6)} ${'PMrng'.padEnd(7)} ${'MaxFav'.padEnd(7)} Trend`);
  console.log('-'.repeat(110));

  sweet.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
  for(const t of sweet){
    const cp=t.pnl*MULT;const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
    console.log(`${t.date.padEnd(11)} ${t.time.padEnd(9)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} ${t.level.padEnd(4)} $${String(t.levelPrice).padEnd(8)} $${String(t.entry).padEnd(8)} ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${(cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(4)} ${icon}${t.result.padEnd(5)} $${t.pmRange.toFixed(1).padStart(5)} $${t.maxFav.toFixed(2).padStart(5)} ${t.dayTrend}`);
  }

  const sw=sweet.filter(t=>t.result==='WIN').length;
  const sl=sweet.filter(t=>t.result==='LOSS').length;
  const sb=sweet.filter(t=>t.result==='BE').length;
  const spnl=sweet.reduce((s,t)=>s+t.pnl,0);
  const sgw=sweet.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const sgl=Math.abs(sweet.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
  const days=new Set(sweet.map(t=>t.date)).size;
  console.log(`\nPM $2-5: ${sweet.length} trades | ${sw}W ${sl}L ${sb}BE | WR ${((sw/sweet.length)*100).toFixed(0)}% | PF ${sgl>0?(sgw/sgl).toFixed(2):'∞'} | $${(spnl*MULT).toFixed(0)} (${days}d → $${(spnl*MULT/days).toFixed(0)}/d)`);
}

run().catch(console.error);
