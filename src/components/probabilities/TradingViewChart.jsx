import React from 'react';

export default function TradingViewChart({ ticker }) {
  if (!ticker) return null;

  const src = `https://s.tradingview.com/widgetembed/?frameElementId=tv_chart&symbol=${ticker}&interval=5&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=1a2235&studies=[]&theme=dark&style=1&timezone=America%2FNew_York&studies_overrides={}&overrides={}&enabled_features=[]&disabled_features=[]&locale=es&utm_source=&utm_medium=widget&utm_campaign=chart&utm_term=${ticker}`;

  return (
    <div className="rounded-xl overflow-hidden border border-border/50 bg-card">
      <div className="px-4 pt-3 pb-2 text-xs font-semibold text-muted-foreground">
        📈 Gráfico — {ticker} (5min)
      </div>
      <iframe
        src={src}
        style={{ width: '100%', height: '450px', border: 'none' }}
        allowFullScreen
        title={`TradingView ${ticker}`}
      />
    </div>
  );
}