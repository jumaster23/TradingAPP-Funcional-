// LEVEL + FIB: Price touches PMH/PDH/PDL/PML → reacts → retrace to fib 50% → ENTER
// 1. Detect level touch (breakout or rejection)
// 2. Wait for pullback to fib 50% of the move from level
// 3. Enter with tight stop below fib 61.8%

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker,interval,range){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});const data=await res.json();const r=data?.chart?.result?.[0];if(!r)return null;
  const q=r.indicators?.quote?.[0]||{};return{timestamps:r.timestamp||[],opens:q.open||[],highs:q.high||[],lows:q.low||[],closes:q.close||[],volumes:q.volume||[]};}

function calcEMA(a,p){if(!a||a.length<p)return[];const k=2/(p+1);const e=[a[0]];for(let i=1;i<a.length;i++)e.push(a[i]!=null?a[i]*k+e[i-1]*(1-k):e[i-1]);return e;}
function getMinutesET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return et.getHours()*60+et.getMinutes();}
function getDayKeyET(ts){const d=new Date(ts*1000),et=new Date(d.toLocaleString('en-US',{timeZone:'America/New_York'}));return`${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;}
function groupByDay(ts){const d={};for(let i=0;i<ts.length;i++){const k=getDayKeyET(ts[i]);if(!d[k])d[k]=[];d[k].push(i);}return d;}

function mergeLevels(levels){const pri={PDH:3,PDL:3,PMH:2,PML:2};const sorted=[...levels].sort((a,b)=>a.price-b.price);const merged=[],used=new Set();for(let i=0;i<sorted.length;i++){if(used.has(i))continue;let best=sorted[i];for(let j=i+1;j<sorted.length;j++){if(used.has(j))continue;if(Math.abs(sorted[j].price-best.price)/best.price<0.005){if((pri[sorted[j].name]||0)>(pri[best.name]||0)){used.add(i);best=sorted[j];}used.add(j);}}merged.push(best);}return merged;}

function simulateTrade(dir,entry,sl,tp,data,si,ei){
  let maxFav=0;
  for(let j=si+1;j<=ei;j++){const h=data.highs[j],l=data.lows[j];if(h==null||l==null)continue;
    if(dir==='CALL'){maxFav=Math.max(maxFav,h-entry);if(l<=sl)return{pnl:sl-entry,type:'STOP',maxFav,exitIdx:j};if(h>=tp)return{pnl:tp-entry,type:'TARGET',maxFav,exitIdx:j};}
    else{maxFav=Math.max(maxFav,entry-l);if(h>=sl)return{pnl:entry-sl,type:'STOP',maxFav,exitIdx:j};if(l<=tp)return{pnl:entry-tp,type:'TARGET',maxFav,exitIdx:j};}}
  const ep=data.closes[ei]||entry;return{pnl:dir==='CALL'?ep-entry:entry-ep,type:'EOD',maxFav,exitIdx:ei};}

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
      const prevDk=dayKeys[di-1];const prevIndices=days[prevDk];if(!prevIndices)continue;

      // Levels
      let rawLevels=[];
      let pdh=-Infinity,pdl=Infinity;
      for(const pi of prevIndices){const m=getMinutesET(data5m.timestamps[pi]);if(m>=570&&m<960){if(data5m.highs[pi]!=null&&data5m.highs[pi]>pdh)pdh=data5m.highs[pi];if(data5m.lows[pi]!=null&&data5m.lows[pi]<pdl)pdl=data5m.lows[pi];}}
      if(pdh!==-Infinity){rawLevels.push({name:'PDH',price:+pdh.toFixed(2)});rawLevels.push({name:'PDL',price:+pdl.toFixed(2)});}
      let pmh=-Infinity,pml=Infinity,pmc=0;
      for(const ci of indices){const m=getMinutesET(data5m.timestamps[ci]);if(m>=240&&m<570){if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];pmc++;}}
      if(pmc>=3&&pmh!==-Infinity){rawLevels.push({name:'PMH',price:+pmh.toFixed(2)});rawLevels.push({name:'PML',price:+pml.toFixed(2)});}
      const levels=mergeLevels(rawLevels);if(!levels.length)continue;

      const regIdx=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<955;});
      if(regIdx.length<10)continue;

      // For each level, track: touched? broke? what was the swing after touch?
      const levelState={};
      for(const lv of levels)levelState[lv.name]={touched:false,broke:false,swingHigh:null,swingLow:null,entryDone:false};

      for(let ri=1;ri<regIdx.length-2;ri++){
        const ci=regIdx[ri];
        const price=data5m.closes[ci],h=data5m.highs[ci],l=data5m.lows[ci],o=data5m.opens[ci],c=data5m.closes[ci];
        if(!price||!h||!l||!o)continue;
        const prevCi=regIdx[ri-1];
        const prevH=data5m.highs[prevCi],prevL=data5m.lows[prevCi];
        const cts=data5m.timestamps[ci];
        const time=new Date(cts*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

        for(const lv of levels){
          const st=levelState[lv.name];
          if(st.entryDone)continue;

          // === STEP 1: Detect level touch ===

          // BREAKOUT UP through resistance (PMH/PDH)
          if(!st.touched&&(lv.name==='PMH'||lv.name==='PDH')&&h>lv.price&&prevH!=null&&prevH<=lv.price){
            st.touched=true;st.broke=true;
            st.swingHigh=h;st.swingLow=lv.price; // swing from level to high
            st.dir='CALL';st.touchCandle=ri;
            continue; // wait for pullback
          }

          // REJECTION DOWN from resistance → PUT
          if(!st.touched&&(lv.name==='PMH'||lv.name==='PDH')&&h>=lv.price*0.998&&c<lv.price){
            st.touched=true;st.broke=false;
            st.swingHigh=lv.price;st.swingLow=l; // swing from level down to low
            st.dir='PUT';st.touchCandle=ri;
            continue;
          }

          // BREAKOUT DOWN through support (PDL/PML)
          if(!st.touched&&(lv.name==='PDL'||lv.name==='PML')&&l<lv.price&&prevL!=null&&prevL>=lv.price){
            st.touched=true;st.broke=true;
            st.swingHigh=lv.price;st.swingLow=l;
            st.dir='PUT';st.touchCandle=ri;
            continue;
          }

          // REJECTION UP from support → CALL
          if(!st.touched&&(lv.name==='PDL'||lv.name==='PML')&&l<=lv.price*1.002&&c>lv.price){
            st.touched=true;st.broke=false;
            st.swingHigh=h;st.swingLow=lv.price;
            st.dir='CALL';st.touchCandle=ri;
            continue;
          }

          // === STEP 2: After touch, update swing extremes ===
          if(st.touched&&!st.entryDone&&ri>st.touchCandle&&ri<=st.touchCandle+6){
            // Track the extreme of the move after touch (up to 6 candles = 30min)
            if(st.dir==='CALL'&&h>st.swingHigh)st.swingHigh=h;
            if(st.dir==='PUT'&&l<st.swingLow)st.swingLow=l;
          }

          // === STEP 3: Wait for fib 50% retrace, then enter ===
          if(st.touched&&!st.entryDone&&ri>st.touchCandle+1&&ri<=st.touchCandle+12){
            const range=st.swingHigh-st.swingLow;
            if(range<0.20)continue; // too small

            const fib50=st.dir==='CALL'?st.swingHigh-range*0.50:st.swingLow+range*0.50;
            const fib618=st.dir==='CALL'?st.swingHigh-range*0.618:st.swingLow+range*0.618;

            // Trend filter
            if(st.dir==='CALL'&&dt==='DOWN')continue;
            if(st.dir==='PUT'&&dt==='UP')continue;

            // Check if price retraced to fib50
            if(st.dir==='CALL'){
              // Price pulled back down to fib50 → enter CALL
              if(l<=fib50*1.002&&c>fib50&&c>o){
                st.entryDone=true;tc++;
                const entry=+c.toFixed(2);
                const sl=+(fib618-0.10).toFixed(2); // stop below fib 61.8%
                const stopDist=entry-sl;
                const tp=+(entry+stopDist*2).toFixed(2); // 1:2 R:R
                const eod=regIdx[regIdx.length-1];
                const maxExit=Math.min(eod,regIdx[Math.min(ri+12,regIdx.length-1)]);
                const res=simulateTrade('CALL',entry,sl,tp,data5m,ci,maxExit);
                const exitTime=new Date(data5m.timestamps[res.exitIdx]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

                allTrades.push({
                  date:dk,time,exitTime,ticker,dir:'CALL',
                  level:lv.name,levelPrice:lv.price,
                  action:st.broke?'BREAKOUT→pullback':'REJECTION→bounce',
                  swH:+st.swingHigh.toFixed(2),swL:+st.swingLow.toFixed(2),range:+range.toFixed(2),
                  fib50:+fib50.toFixed(2),
                  entry,sl,tp,
                  pnl:+res.pnl.toFixed(2),exitType:res.type,
                  result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
                  maxFav:+res.maxFav.toFixed(2),dayTrend:dt,
                  stopDist:+stopDist.toFixed(2),
                });
              }
            }else{
              // Price rallied up to fib50 → enter PUT
              if(h>=fib50*0.998&&c<fib50&&c<o){
                st.entryDone=true;tc++;
                const entry=+c.toFixed(2);
                const sl=+(fib618+0.10).toFixed(2);
                const stopDist=sl-entry;
                const tp=+(entry-stopDist*2).toFixed(2);
                const eod=regIdx[regIdx.length-1];
                const maxExit=Math.min(eod,regIdx[Math.min(ri+12,regIdx.length-1)]);
                const res=simulateTrade('PUT',entry,sl,tp,data5m,ci,maxExit);
                const exitTime=new Date(data5m.timestamps[res.exitIdx]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

                allTrades.push({
                  date:dk,time,exitTime,ticker,dir:'PUT',
                  level:lv.name,levelPrice:lv.price,
                  action:st.broke?'BREAKDOWN→rally':'REJECTION→drop',
                  swH:+st.swingHigh.toFixed(2),swL:+st.swingLow.toFixed(2),range:+range.toFixed(2),
                  fib50:+fib50.toFixed(2),
                  entry,sl,tp,
                  pnl:+res.pnl.toFixed(2),exitType:res.type,
                  result:res.pnl>0?'WIN':res.pnl===0?'BE':'LOSS',
                  maxFav:+res.maxFav.toFixed(2),dayTrend:dt,
                  stopDist:+stopDist.toFixed(2),
                });
              }
            }
          }

          // Expired — no retrace within 12 candles (1hr)
          if(st.touched&&!st.entryDone&&ri>st.touchCandle+12){
            st.entryDone=true; // skip this level
          }
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  allTrades.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
  const MULT=0.50*2*100/2;

  // Apply max 5/day
  const byDay={};allTrades.forEach(t=>{if(!byDay[t.date])byDay[t.date]=[];byDay[t.date].push(t);});
  const taken=[];
  for(const [day,trades] of Object.entries(byDay).sort())taken.push(...trades.slice(0,5));

  console.log('\n'+'='.repeat(140));
  console.log('LEVEL + FIBONACCI RETRACE — Max 5/día');
  console.log('Precio toca nivel → reacciona → retrace a fib 50% → ENTRA con SL en fib 61.8% → TP 1:2');
  console.log('='.repeat(140));

  console.log(`\n${'Fecha'.padEnd(11)} ${'Hora'.padEnd(9)} ${'Exit'.padEnd(9)} ${'Tkr'.padEnd(6)} ${'Dir'.padEnd(5)} ${'Nivel'.padEnd(12)} ${'Acción'.padEnd(22)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP'.padEnd(9)} ${'Fib50'.padEnd(9)} ${'PnL'.padEnd(8)} ${'$2c'.padEnd(7)} Res`);
  console.log('-'.repeat(140));

  let currentDay='';
  for(const t of taken){
    if(t.date!==currentDay&&currentDay){
      const dt=taken.filter(x=>x.date===currentDay);const dp=dt.reduce((s,x)=>s+x.pnl,0)*MULT;
      const dw=dt.filter(x=>x.result==='WIN').length;const dl=dt.filter(x=>x.result==='LOSS').length;
      console.log(`${''.padEnd(105)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)} (${dw}W ${dl}L)`);console.log('');
    }
    currentDay=t.date;
    const cp=t.pnl*MULT;const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
    console.log(`${t.date.padEnd(11)} ${t.time.padEnd(9)} ${t.exitTime.padEnd(9)} ${t.ticker.padEnd(6)} ${t.dir.padEnd(5)} ${(t.level+' $'+t.levelPrice).padEnd(12)} ${t.action.padEnd(22)} $${String(t.entry).padEnd(8)} $${String(t.sl).padEnd(8)} $${String(t.tp).padEnd(8)} $${String(t.fib50).padEnd(8)} ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${(cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(4)} ${icon}${t.result}`);
  }
  {const dt=taken.filter(x=>x.date===currentDay);const dp=dt.reduce((s,x)=>s+x.pnl,0)*MULT;const dw=dt.filter(x=>x.result==='WIN').length;const dl=dt.filter(x=>x.result==='LOSS').length;
  console.log(`${''.padEnd(105)} DIA: ${dp>=0?'+':''}$${dp.toFixed(0)} (${dw}W ${dl}L)`);}

  // Summary
  const w=taken.filter(t=>t.result==='WIN').length;const l=taken.filter(t=>t.result==='LOSS').length;const b=taken.filter(t=>t.result==='BE').length;
  const pnl=taken.reduce((s,t)=>s+t.pnl,0);const cpnl=pnl*MULT;
  const gw=taken.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);const gl=Math.abs(taken.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
  const days=new Set(taken.map(t=>t.date)).size;

  // By action type
  console.log('\n--- POR TIPO ---');
  for(const act of ['BREAKOUT→pullback','REJECTION→bounce','BREAKDOWN→rally','REJECTION→drop']){
    const at=taken.filter(t=>t.action===act);if(!at.length)continue;
    const aw=at.filter(t=>t.result==='WIN').length;const al=at.filter(t=>t.result==='LOSS').length;
    console.log(`  ${act.padEnd(22)} ${at.length} trades | ${aw}W ${al}L | WR ${((aw/at.length)*100).toFixed(0)}%`);
  }

  // Avg stop size
  const avgStop=taken.reduce((s,t)=>s+t.stopDist,0)/taken.length;

  console.log(`\n${'='.repeat(140)}`);
  console.log(`TOTAL: ${taken.length} trades en ${days} días (${(taken.length/days).toFixed(1)}/d)`);
  console.log(`${w}W ${l}L ${b}BE | WR ${((w/taken.length)*100).toFixed(0)}% | PF ${gl>0?(gw/gl).toFixed(2):'∞'}`);
  console.log(`2 contratos: $${cpnl.toFixed(0)} ($${(cpnl/days).toFixed(0)}/día) | Avg stop: $${avgStop.toFixed(2)}`);
}

run().catch(console.error);
