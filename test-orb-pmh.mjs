// ORB 5min + PMH/PML breakout combo
// Entry ONLY when price breaks ORB HIGH *AND* PMH (or ORB LOW *AND* PML)
// Double confirmation = stronger signal

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

  // Test variants
  const variants={
    'ORB only (baseline)':{trades:[], needPM:false, needORB:true},
    'PMH/PML only (baseline)':{trades:[], needPM:true, needORB:false},
    'ORB + PMH/PML (both must break)':{trades:[], needPM:true, needORB:true},
    'ORB or PMH (either one)':{trades:[], needPM:'either', needORB:'either'},
  };

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

      // PMH/PML
      let pmh=-Infinity,pml=Infinity,pmc=0;
      for(const ci of indices){const m=getMinutesET(data5m.timestamps[ci]);if(m>=240&&m<570){if(data5m.highs[ci]!=null&&data5m.highs[ci]>pmh)pmh=data5m.highs[ci];if(data5m.lows[ci]!=null&&data5m.lows[ci]<pml)pml=data5m.lows[ci];pmc++;}}
      const pmRange=pmh!==-Infinity?pmh-pml:0;
      if(pmRange>6)continue; // PM filter

      // ORB
      const fc=indices.find(ci=>getMinutesET(data5m.timestamps[ci])>=570);
      if(fc==null)continue;
      const orbH=data5m.highs[fc],orbL=data5m.lows[fc];if(!orbH||!orbL)continue;
      const orbRange=orbH-orbL;

      const regAfter=indices.filter(ci=>{const m=getMinutesET(data5m.timestamps[ci]);return m>=575&&m<960;});
      if(regAfter.length<10)continue;

      // Track what's been broken
      for(const [vName,v] of Object.entries(variants)){
        let done=false;
        let orbBroken=false, pmhBroken=false, pmlBroken=false;

        for(let ri=0;ri<regAfter.length-1&&!done;ri++){
          const ci=regAfter[ri];const h=data5m.highs[ci],l=data5m.lows[ci];if(!h||!l)continue;
          const breakTs=data5m.timestamps[ci];
          const time=new Date(breakTs*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});

          if(h>orbH)orbBroken=true;
          if(pmc>=3&&pmh!==-Infinity&&h>pmh)pmhBroken=true;
          if(pmc>=3&&pml!==Infinity&&l<pml)pmlBroken=true;

          // CALL check
          let callOk=false;
          if(vName.includes('ORB only')&&orbBroken&&h>orbH)callOk=true;
          if(vName.includes('PMH/PML only')&&pmhBroken&&h>pmh)callOk=true;
          if(vName.includes('both must')&&orbBroken&&pmhBroken)callOk=true;
          if(vName.includes('either')&&(orbBroken||pmhBroken))callOk=true;

          if(callOk&&!done){
            if(dt==='DOWN')continue;
            if(!check5m(spxD,breakTs,'CALL',false)||!check5m(vixD,breakTs,'CALL',true))continue;
            done=true;

            // Use the higher level as entry
            const entry=vName.includes('both')?Math.max(orbH,pmh||0):vName.includes('PMH')?pmh:orbH;
            const slLevel=vName.includes('both')?Math.min(orbL,pml||Infinity):vName.includes('PMH')?(pml||entry-2):orbL;
            const stopDist=entry-slLevel;
            if(stopDist<0.3||stopDist>8)continue;

            const sl=+slLevel.toFixed(2),tp=+(entry+stopDist*2).toFixed(2);
            const eod=regAfter[regAfter.length-1];
            const res=simulateTrade('CALL',+entry.toFixed(2),sl,tp,data5m,ci,eod);
            const exitTime=new Date(data5m.timestamps[res.exitIdx]*1000).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'});
            const touchedSL=res.type==='STOP';

            v.trades.push({
              date:dk,time,exitTime,ticker,dir:'CALL',
              orbH:+orbH.toFixed(2),orbL:+orbL.toFixed(2),orbRange:+orbRange.toFixed(2),
              pmh:pmh!==-Infinity?+pmh.toFixed(2):null,pml:pml!==Infinity?+pml.toFixed(2):null,pmRange:+pmRange.toFixed(2),
              entry:+entry.toFixed(2),sl,tp,stopDist:+stopDist.toFixed(2),
              pnl:+res.pnl.toFixed(2),exitType:res.type,
              result:res.pnl>0?'WIN':touchedSL?'LOSS':'BE',
              maxFav:+res.maxFav.toFixed(2),dayTrend:dt,
            });
            if(vName.includes('both'))tc++;
          }
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r=>setTimeout(r,200));
  }

  const MULT=50;
  console.log('\n'+'='.repeat(110));
  console.log('ORB + PMH/PML COMBO — Comparación (PM<$6, SPX+VIX, trend)');
  console.log('='.repeat(110));

  for(const [name,v] of Object.entries(variants)){
    const t=v.trades;if(!t.length)continue;
    const w=t.filter(x=>x.result==='WIN').length,l=t.filter(x=>x.result==='LOSS').length,b=t.filter(x=>x.result==='BE').length;
    const pnl=t.reduce((s,x)=>s+x.pnl,0);const gw=t.filter(x=>x.pnl>0).reduce((s,x)=>s+x.pnl,0);const gl=Math.abs(t.filter(x=>x.pnl<0).reduce((s,x)=>s+x.pnl,0));
    const days=new Set(t.map(x=>x.date)).size;
    console.log(`\n${name}`);
    console.log(`  ${t.length} trades (${(t.length/days).toFixed(1)}/d) | ${w}W ${l}L ${b}BE | WR real ${(((w+b)/t.length)*100).toFixed(0)}% | PF ${gl>0?(gw/gl).toFixed(2):'∞'} | $${Math.round(pnl*MULT)} ($${Math.round(pnl*MULT/days)}/d)`);
  }

  // Show trades for combo (both must break)
  const combo=variants['ORB + PMH/PML (both must break)'];
  if(combo.trades.length){
    console.log('\n\n'+'='.repeat(140));
    console.log('DETALLE: ORB + PMH/PML (ambos deben romper)');
    console.log('='.repeat(140));
    console.log(`\n${'Fecha'.padEnd(11)} ${'Hora'.padEnd(9)} ${'Exit'.padEnd(9)} ${'Tkr'.padEnd(6)} ${'ORB H'.padEnd(8)} ${'PMH'.padEnd(8)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP'.padEnd(9)} ${'StpDist'.padEnd(8)} ${'PnL'.padEnd(8)} ${'$2c'.padEnd(7)} ${'MaxFav'.padEnd(7)} Res`);
    console.log('-'.repeat(130));

    combo.trades.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
    for(const t of combo.trades){
      const cp=t.pnl*MULT;const icon=t.result==='WIN'?'✅':t.result==='BE'?'⚪':'❌';
      console.log(
        t.date.padEnd(11)+t.time.padEnd(9)+t.exitTime.padEnd(9)+t.ticker.padEnd(6)+
        '$'+String(t.orbH).padEnd(7)+' $'+String(t.pmh||'—').padEnd(7)+
        ' $'+String(t.entry).padEnd(8)+'$'+String(t.sl).padEnd(8)+' $'+String(t.tp).padEnd(8)+
        '$'+t.stopDist.toFixed(2).padEnd(7)+
        (t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(7)+' '+(cp>=0?'+':'')+'$'+cp.toFixed(0).padStart(4)+
        '   $'+t.maxFav.toFixed(2).padStart(5)+'   '+icon+' '+t.result
      );
    }

    // By ticker
    console.log('\n--- POR TICKER ---');
    for(const ticker of TICKERS){
      const tt=combo.trades.filter(t=>t.ticker===ticker);if(!tt.length)continue;
      const tw=tt.filter(t=>t.result==='WIN').length,tl=tt.filter(t=>t.result==='LOSS').length,tb=tt.filter(t=>t.result==='BE').length;
      console.log(`  ${ticker.padEnd(6)} ${tt.length} trades | ${tw}W ${tl}L ${tb}BE | WR ${(((tw+tb)/tt.length)*100).toFixed(0)}% | $${Math.round(tt.reduce((s,t)=>s+t.pnl,0)*MULT)}`);
    }
  }
}

run().catch(console.error);
