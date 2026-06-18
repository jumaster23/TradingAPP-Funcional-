// TODAY: 15min fib50 SL=$1 TP=$2 + EMA trend + daily trend

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

function calcEMA(a,p){if(!a||a.length<p)return[];const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}

function simulateScalp(dir,entry,sl,tp,data,si,ei){
  const tgt=dir==='CALL'?entry+tp:entry-tp;
  const stop=dir==='CALL'?entry-sl:entry+sl;
  let maxFav=0;
  for(let j=si+1;j<=ei;j++){const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){maxFav=Math.max(maxFav,h-entry);if(l<=stop)return{pnl:stop-entry,type:'STOP',maxFav,exitIdx:j};if(h>=tgt)return{pnl:tgt-entry,type:'TARGET',maxFav,exitIdx:j};}
    else{maxFav=Math.max(maxFav,entry-l);if(h>=stop)return{pnl:entry-stop,type:'STOP',maxFav,exitIdx:j};if(l<=tgt)return{pnl:entry-tgt,type:'TARGET',maxFav,exitIdx:j};}}
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD',maxFav,exitIdx:ei};}

async function run(){
  const today=new Date().toISOString().slice(0,10);
  console.log(`\nFIBONACCI SCALP HOY (${today})`);
  console.log('Config: 15min swings → Fib 50% retrace → CALL/PUT');
  console.log('SL=$1 | TP=$2 | EMA10>EMA20 para dirección | Max 5/ticker');
  console.log('='.repeat(120));

  const allTrades=[];

  for(const ticker of TICKERS){
    process.stdout.write(`${ticker}... `);
    const [data5m,dailyData]=await Promise.all([fetchChart(ticker,'5m','2d'),fetchChart(ticker,'1d','3mo')]);
    if(!data5m){console.log('skip');continue;}

    const days=groupByDay(data5m.timestamps);const dayKeys=Object.keys(days).sort();
    const todayKey=dayKeys.find(k=>k===today);
    if(!todayKey){console.log('no data');continue;}
    const indices=days[todayKey];

    const ema10=calcEMA(data5m.closes,10);const ema20=calcEMA(data5m.closes,20);
    const dCloses=dailyData?dailyData.closes.filter(v=>v!=null):[];const dTs=dailyData?dailyData.timestamps:[];const dEma10=calcEMA(dCloses,10);
    let dayTrend='NEUTRAL';
    if(dCloses.length>=12){const idx=dCloses.length-1;if(dCloses[idx]>dEma10[idx]&&dCloses[idx-1]>dCloses[idx-2])dayTrend='UP';else if(dCloses[idx]<dEma10[idx]&&dCloses[idx-1]<dCloses[idx-2])dayTrend='DOWN';}

    const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=585&&m<955;});
    if(regIdx.length<8){console.log('few candles');continue;}

    let tc=0;
    for(let ri=5;ri<regIdx.length-2;ri++){
      if(tc>=5)break;
      const ci=regIdx[ri];
      const price=data5m.closes[ci];if(!price)continue;
      const e10=ema10[ci],e20=ema20[ci];if(!e10||!e20)continue;
      const cts=data5m.timestamps[ci];
      const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

      // 15min swing = last 3 candles of 5min
      let swH=-Infinity,swL=Infinity;
      for(let j=ri-3;j<ri;j++){
        const jci=regIdx[j];
        if(data5m.highs[jci]!=null&&data5m.highs[jci]>swH)swH=data5m.highs[jci];
        if(data5m.lows[jci]!=null&&data5m.lows[jci]<swL)swL=data5m.lows[jci];
      }
      const range=swH-swL;
      if(range<0.20||range>20)continue;

      const fib50=swH-range*0.500;

      let dir=null;
      const lo=data5m.lows[ci],hi=data5m.highs[ci],cl=data5m.closes[ci],op=data5m.opens[ci];

      // Touch fib50 from above → CALL (pullback buy)
      if(lo!=null&&lo<=fib50*1.002&&cl>fib50&&cl>op){
        if(e10>e20&&dayTrend!=='DOWN')dir='CALL';
      }
      // Touch fib50 from below → PUT (rally sell)
      if(!dir&&hi!=null&&hi>=fib50*0.998&&cl<fib50&&cl<op){
        if(e10<e20&&dayTrend!=='UP')dir='PUT';
      }
      // Price at fib50 level, came from above
      if(!dir&&price<=fib50*1.001&&price>=fib50*0.999){
        const prevPrice=data5m.closes[regIdx[ri-1]];
        if(prevPrice>fib50&&price<=fib50&&e10>e20&&dayTrend!=='DOWN')dir='CALL';
        if(prevPrice<fib50&&price>=fib50&&e10<e20&&dayTrend!=='UP')dir='PUT';
      }

      if(!dir)continue;

      const sl=1.0,tp=2.0;
      if(sl/price>0.015)continue;

      const eod=regIdx[regIdx.length-1];
      const maxExit=Math.min(eod,regIdx[Math.min(ri+12,regIdx.length-1)]);
      const res=simulateScalp(dir,price,sl,tp,data5m,ci,maxExit);
      const exitTime=new Date(data5m.timestamps[res.exitIdx]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

      allTrades.push({
        time,exitTime,ticker,dir,
        entry:+price.toFixed(2),
        slPrice:+(dir==='CALL'?price-sl:price+sl).toFixed(2),
        tpPrice:+(dir==='CALL'?price+tp:price-tp).toFixed(2),
        fib50:+fib50.toFixed(2),swH:+swH.toFixed(2),swL:+swL.toFixed(2),range:+range.toFixed(2),
        pnl:+res.pnl.toFixed(2),exitType:res.type,
        result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
        maxFav:+res.maxFav.toFixed(2),dayTrend,
      });
      tc++;
      ri+=2;
    }
    console.log(`${tc} trades`);
    await new Promise(r=>setTimeout(r,200));
  }

  allTrades.sort((a,b)=>a.time.localeCompare(b.time));

  const MULT=0.50*2*100/2;

  console.log(`\n${'#'.padEnd(3)} ${'Hora'.padEnd(9)} ${'Exit'.padEnd(9)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP'.padEnd(9)} ${'Fib50'.padEnd(9)} ${'Swing'.padEnd(15)} ${'PnL'.padEnd(8)} ${'$2c'.padEnd(7)} ${'Res'.padEnd(7)} ${'MaxFav'.padEnd(7)} Trend`);
  console.log('-'.repeat(130));

  let totalPnl=0;
  for(let i=0;i<allTrades.length;i++){
    const t=allTrades[i];
    const cp=t.pnl*MULT;totalPnl+=cp;
    const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
    console.log(`${String(i+1).padEnd(3)} ${t.time.padEnd(9)} ${t.exitTime.padEnd(9)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} $${String(t.entry).padEnd(8)} $${String(t.slPrice).padEnd(8)} $${String(t.tpPrice).padEnd(8)} $${String(t.fib50).padEnd(8)} $${t.swL}-${t.swH}  ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${(cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(4)} ${icon} ${t.result.padEnd(5)} $${t.maxFav.toFixed(2).padStart(5)} ${t.dayTrend}`);
  }

  const w=allTrades.filter(t=>t.result==='WIN').length;
  const l=allTrades.filter(t=>t.result==='LOSS').length;

  console.log(`\n${'='.repeat(130)}`);
  console.log(`HOY: ${allTrades.length} trades | ${w}W ${l}L | WR ${allTrades.length?((w/allTrades.length)*100).toFixed(0):0}% | Total: ${totalPnl>=0?'+':''}$${totalPnl.toFixed(0)} (2 contratos)`);
}

run().catch(console.error);
