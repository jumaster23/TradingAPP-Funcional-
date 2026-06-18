import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  BarChart2, TrendingUp, BookOpen, Newspaper, Building2, Settings,
  BookMarked, ChevronDown, ChevronUp, Database, Wifi, Brain, Target,
  Shield, AlertTriangle, Clock, Activity, Layers, GitMerge
} from 'lucide-react';

const TABS = [
  {
    id: 'probabilities',
    icon: BarChart2,
    color: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/30',
    title: 'Probabilidades',
    subtitle: 'Dashboard principal de análisis cuantitativo',
    description: 'Esta pestaña es el núcleo analítico del sistema. Combina datos históricos estadísticos (almacenados en base de datos) con precios en tiempo real para generar probabilidades de breakout, llenado de gap, y niveles de operación.',
    dataInputs: [
      { icon: Database, color: 'text-primary', label: 'Estadísticas históricas (DB)', detail: 'Probabilidades de ruptura ORB, tasa de llenado de gap, modificadores contextuales. Se calculan una vez por semana por ticker y se cachean.' },
      { icon: Wifi, color: 'text-amber-400', label: 'Precios en tiempo real', detail: 'Yahoo Finance vía backend: precio actual, apertura, máximo, mínimo del día, y cierre de ayer.' },
      { icon: Brain, color: 'text-purple-400', label: 'LLM con búsqueda web', detail: 'Gemini Flash con acceso a internet para VIX, contexto de mercado, niveles gamma/OI, VWAP y señal general.' },
    ],
    sections: [
      {
        title: 'Gap Analysis',
        icon: TrendingUp,
        color: 'text-emerald-400',
        explanation: 'Mide la diferencia entre el cierre de ayer y la apertura de hoy. Un gap UP significa que el mercado abrió más alto; un gap DOWN, más bajo.',
        howToRead: [
          'Cierre Ayer vs Apertura Hoy: la brecha visual muestra el tamaño del gap en USD y %.',
          'Estado del gap: "Sin llenar" = precio no ha regresado al nivel del cierre anterior. "Llenando" = está parcialmente cubierto. "Llenado 100%" = el precio regresó al cierre de ayer.',
          'Probabilidades de llenado: barras históricas que indican qué % de veces gaps similares fueron llenados al 25%, 50%, 75% o 100% en la sesión.',
          'Clasificación: gaps < 0.5% = mucho ruido. Gaps 1-2% = buen escenario. Gaps > 5% = extremos, raramente se llenan el mismo día.',
        ],
      },
      {
        title: 'ORB — Opening Range Breakout',
        icon: Layers,
        color: 'text-cyan-400',
        explanation: 'El ORB es el rango formado en los primeros N minutos de mercado (5, 15, 30 o 60 min). Si el precio rompe ese rango con convicción, estadísticamente tiende a continuar en esa dirección.',
        howToRead: [
          'H y L del ORB: niveles clave. La ruptura sobre H = señal CALL. Ruptura bajo L = señal PUT.',
          'Estado actual: indica si hoy ya rompió, en qué dirección, o si sigue consolidando.',
          'Single Break: % histórico de veces que el precio rompe un solo lado y continúa (escenario ideal).',
          'Double Break (whipsaw): el precio rompe ambos lados — trampa. Evitar operar en este escenario.',
          'Consolidación: el precio no rompe ningún lado durante toda la sesión.',
          'Ruptura limpia vs fallida: de las veces que rompe, qué % continúa vs cuántos revierten en 30 min.',
          'Modificadores contextuales: ajustes de probabilidad según VIX, volumen, confluencia de índices, gamma walls.',
          'Niveles de operación: Entry justo sobre/bajo el ORB, Stop al extremo opuesto + buffer, TP = extensión 2x rango.',
        ],
      },
    ],
    tips: [
      'Un gap moderado (0.5–2%) con ORB de rango pequeño y volumen alto en la ruptura = escenario ideal.',
      'Si el VIX está sobre 25, reduce el tamaño de posición — la volatilidad aumenta los whipsaws.',
      'Siempre espera confirmación de SPX y NQ antes de entrar en una ruptura de ORB en acciones individuales.',
    ],
  },
  {
    id: 'daytrading',
    icon: Activity,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    title: 'Day Trading',
    subtitle: 'Análisis multi-timeframe intradía',
    description: 'Ofrece un análisis técnico profundo en múltiples timeframes (1min, 5min, 15min, 30min) para identificar oportunidades de scalp e intraday. Integra niveles EMA, confirmación de volumen, y patrones de estructura de mercado.',
    dataInputs: [
      { icon: Wifi, color: 'text-amber-400', label: 'Datos en tiempo real + web', detail: 'LLM con búsqueda de internet para obtener EMAs actualizadas, volumen, niveles técnicos y contexto de mercado en el momento del análisis.' },
      { icon: Brain, color: 'text-purple-400', label: 'Análisis LLM multi-timeframe', detail: 'El modelo evalúa simultáneamente scalp (1-5min) e intraday (15-30min) y genera señales diferenciadas para cada horizonte temporal.' },
    ],
    sections: [
      {
        title: 'Módulo Scalp (1–5 min)',
        icon: Clock,
        color: 'text-cyan-400',
        explanation: 'Estrategias para operaciones muy cortas (segundos a minutos). Requiere spreads ajustados y alta liquidez.',
        howToRead: [
          'Señal CALL/PUT: dirección recomendada para el siguiente movimiento corto.',
          'EMA 9/20/50: si el precio está sobre las 3 EMAs = tendencia alcista limpia. Bajo las 3 = bajista.',
          'Confirmación de volumen: el volumen debe ser mayor al promedio para confirmar el movimiento.',
          'Timeframes 1min/5min/15min: deben estar alineados para una entrada de alta probabilidad.',
        ],
      },
      {
        title: 'Módulo Intraday (15–30 min)',
        icon: Target,
        color: 'text-emerald-400',
        explanation: 'Operaciones que duran de 30 minutos a toda la sesión. Mayor tiempo de retención, mejores relaciones riesgo/beneficio.',
        howToRead: [
          'Estructura de mercado: HH/HL (Higher High/Higher Low) = alcista. LH/LL = bajista.',
          'Confluencia de índices: si SPX y NQ confirman la misma dirección = mayor convicción.',
          'Regla de gestión de riesgo: mover el stop a breakeven cuando el precio alcanza el 50% del TP.',
          'Invalidación: si el precio cierra por dentro del ORB o de vuelta del lado equivocado de la EMA 20.',
        ],
      },
      {
        title: 'Patrones de Estructura',
        icon: GitMerge,
        color: 'text-purple-400',
        explanation: 'Detecta automáticamente 3 patrones clásicos intradía: barrido de liquidez, pullback en tendencia, y breakout-retest.',
        howToRead: [
          'Barrido de liquidez: precio toma stops bajo un mínimo previo y revierte — señal contraria al barrido.',
          'Pullback en tendencia: precio retrocede a la EMA en una tendencia clara — entrada a favor.',
          'Breakout-retest: precio rompe un nivel, regresa a testearlo, y rebota — confirmación de la ruptura.',
        ],
      },
    ],
    tips: [
      'Para scalp, opera solo entre 9:30–11:00 AM ET y 3:00–4:00 PM ET (mayor volatilidad y volumen).',
      'Nunca scalpes contra la tendencia del timeframe de 15 minutos.',
      'Si los 3 timeframes (5m, 15m, 30m) no están alineados, espera o no operes.',
    ],
  },
  {
    id: 'swing',
    icon: TrendingUp,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    title: 'Swing',
    subtitle: 'Análisis de posiciones de 2 a 10 días',
    description: 'Diseñado para operaciones que se mantienen varios días. Evalúa tendencias diarias y semanales, niveles de soporte/resistencia, open interest de opciones y Williams %R para encontrar setups de alta calidad.',
    dataInputs: [
      { icon: Wifi, color: 'text-amber-400', label: 'Datos diarios/semanales + web', detail: 'LLM con internet para acceder a gráficos diarios, OI de opciones, gamma, y flujo institucional.' },
      { icon: Brain, color: 'text-purple-400', label: 'Scanner de mercado', detail: 'Escanea automáticamente el mercado buscando los mejores setups swing con criterios técnicos y de flujo de opciones.' },
    ],
    sections: [
      {
        title: 'Checklist de Calidad (10 puntos)',
        icon: Shield,
        color: 'text-primary',
        explanation: 'Un setup de swing de alta calidad debe pasar la mayoría de estos 10 criterios. Cuantos más ✅, mayor es la probabilidad de éxito.',
        howToRead: [
          '✅ Tendencia diaria alineada: el precio está sobre la EMA 50 diaria.',
          '✅ Tendencia semanal alineada: el precio está sobre la EMA 20 semanal.',
          '✅ Soporte/Resistencia claro: nivel técnico bien definido cerca del precio.',
          '✅ Volumen confirmado: el volumen del día de señal es mayor al promedio.',
          '✅ Open Interest favorable: hay acumulación de calls/puts en la dirección correcta.',
          '✅ Alineación con gamma: el precio está al lado favorable del gamma flip.',
          '✅ Confluencia de índices: SPX y NQ apuntan en la misma dirección.',
          '✅ R/R ≥ 2:1: el take profit es al menos el doble del stop loss.',
          '✅ VIX favorable: VIX bajo 20 para calls, no importa tanto para puts.',
          '✅ Sin catalizadores de riesgo: no hay earnings ni eventos macro inminentes.',
        ],
      },
      {
        title: 'Williams %R',
        icon: Activity,
        color: 'text-amber-400',
        explanation: 'Indicador de momentum que mide si el precio está sobrecomprado o sobrevendido. Rango de -100 a 0.',
        howToRead: [
          '-80 a -100: zona de sobrevendido (posible rebote alcista próximo).',
          '-20 a 0: zona de sobrecomprado (posible corrección bajista próxima).',
          '-50 a -80: zona neutral-bajista (esperar confirmación).',
          'Swing quality = true: el indicador está en zona óptima para el setup.',
          'Se evalúa en timeframe DIARIO y SEMANAL — ambos deben coincidir para alta convicción.',
        ],
      },
    ],
    tips: [
      'El mejor momento para entrar en swing es después de un pullback en tendencia, no en la extensión máxima.',
      'Usa el scanner para encontrar candidatos, pero siempre verifica manualmente el gráfico antes de entrar.',
      'Con 8+ checks en el checklist, la probabilidad histórica de éxito supera el 70%.',
    ],
  },
  {
    id: 'institutional',
    icon: Building2,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    title: 'Institucional',
    subtitle: 'Niveles gamma, open interest y market makers',
    description: 'Analiza el posicionamiento de los market makers y fondos institucionales a través del mercado de opciones. Los niveles gamma y el Open Interest revelan dónde están los "imanes" de precio y las zonas de aceleración.',
    dataInputs: [
      { icon: Wifi, color: 'text-amber-400', label: 'Datos de opciones en tiempo real', detail: 'LLM con internet para gamma exposure, open interest por strike, max pain y gamma flip del día.' },
      { icon: Brain, color: 'text-purple-400', label: 'Cálculo de pivots', detail: 'Los puntos pivote clásicos (PP, S1, S2, S3, R1, R2, R3) se calculan automáticamente con los datos del día anterior.' },
    ],
    sections: [
      {
        title: 'Gamma Exposure (GEX)',
        icon: Layers,
        color: 'text-purple-400',
        explanation: 'El gamma exposure mide cómo reaccionan los market makers cuando el precio se mueve. Por encima del gamma flip, los MMs son "cortos gamma" y amplifican los movimientos.',
        howToRead: [
          'Gamma Flip: nivel donde el GEX cambia de positivo a negativo. Es el nivel clave del día.',
          'Precio > Gamma Flip: MMs compran en subidas y venden en bajas = MERCADO ESTABLE.',
          'Precio < Gamma Flip: MMs venden en subidas y compran en bajas = MERCADO VOLÁTIL.',
          'Call Wall: nivel con mayor concentración de calls — actúa como resistencia magnética.',
          'Put Wall: nivel con mayor concentración de puts — actúa como soporte magnético.',
          'Max Pain: precio donde vencen con pérdida máxima la mayoría de opciones compradas — el mercado tiende a gravitar hacia este nivel cerca del vencimiento.',
        ],
      },
      {
        title: 'Puntos Pivote',
        icon: Target,
        color: 'text-cyan-400',
        explanation: 'Niveles técnicos calculados con la sesión anterior. Usados ampliamente por traders institucionales como niveles de soporte y resistencia.',
        howToRead: [
          'PP (Pivot Point): nivel central del día — si el precio está sobre él, sesgo alcista; bajo él, bajista.',
          'R1, R2, R3: resistencias progresivas arriba del PP.',
          'S1, S2, S3: soportes progresivos bajo el PP.',
          'Cuanto más lejos esté el precio del PP, mayor la reversión media esperada.',
        ],
      },
    ],
    tips: [
      'Cuando el precio está entre el Put Wall y el Call Wall, tiende a oscilar entre ambos (consolidación).',
      'Una ruptura del Call Wall con volumen = señal alcista muy fuerte (los MMs deben cubrirse comprando futuros).',
      'El Max Pain es más relevante los jueves y viernes de semanas de vencimiento de opciones (OpEx).',
    ],
  },
  {
    id: 'news',
    icon: Newspaper,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    title: 'Noticias',
    subtitle: 'Eventos macro y catalizadores del mercado',
    description: 'Agrega noticias económicas y financieras relevantes en tiempo real usando LLM con acceso a internet. Clasifica cada noticia por impacto (alto, medio, bajo) para priorizar qué eventos podrían mover el mercado.',
    dataInputs: [
      { icon: Wifi, color: 'text-amber-400', label: 'Internet en tiempo real', detail: 'El LLM consulta fuentes como Bloomberg, Reuters, CNBC, MarketWatch, FED, y calendarios económicos para resumir los eventos más relevantes.' },
    ],
    sections: [
      {
        title: 'Clasificación de Impacto',
        icon: AlertTriangle,
        color: 'text-amber-400',
        explanation: 'Cada noticia se clasifica según su potencial de mover el mercado.',
        howToRead: [
          '🔴 Impacto Alto: datos macro de primera línea (NFP, IPC, FOMC, PIB). Pueden mover el mercado 1-3% en minutos. Extrema cautela al operar.',
          '🟡 Impacto Medio: datos secundarios (ventas minoristas, ISM, PMI). Movimientos moderados, menor volatilidad.',
          '🟢 Impacto Bajo: datos menores o corporativos. Poco impacto en índices principales.',
        ],
      },
    ],
    tips: [
      'Evita tener posiciones abiertas 15 minutos antes de noticias de impacto alto.',
      'Después de una noticia de impacto alto, espera al menos 5 minutos para que se absorba la volatilidad.',
      'Las noticias de la FED (FOMC) son las más impactantes — pueden cambiar la dirección del mercado por días.',
    ],
  },
  {
    id: 'journal',
    icon: BookOpen,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    title: 'Diario',
    subtitle: 'Registro y análisis de rendimiento',
    description: 'Herramienta de seguimiento personal para registrar cada operación y analizar tu rendimiento a lo largo del tiempo. El diario es esencial para identificar patrones en tus errores y mejorar como trader.',
    dataInputs: [
      { icon: Database, color: 'text-primary', label: 'Base de datos propia', detail: 'Todos los registros se guardan en tu cuenta. Fechas, tickers, dirección, precios de entrada/salida, P&L y notas.' },
    ],
    sections: [
      {
        title: 'Estadísticas de Rendimiento',
        icon: BarChart2,
        color: 'text-primary',
        explanation: 'Métricas calculadas automáticamente con todas tus operaciones registradas.',
        howToRead: [
          'Capital actual: capital inicial + suma de todos los P&L registrados.',
          'Win Rate: % de operaciones ganadoras. Un win rate > 50% con R/R 1:1 ya es rentable.',
          'P&L Total: suma neta de todas las ganancias y pérdidas.',
          'Racha actual: número consecutivo de wins o losses — útil para detectar sobre-operación en malas rachas.',
        ],
      },
      {
        title: 'Calendario de P&L',
        icon: Clock,
        color: 'text-cyan-400',
        explanation: 'Vista mensual que muestra el P&L de cada día en colores para detectar patrones temporales.',
        howToRead: [
          'Verde: día ganador. Rojo: día perdedor. Sin color: sin operaciones ese día.',
          'Semanas rojas consecutivas = señal de revisar tu metodología o tomar un descanso.',
          'Los días de mayor P&L negativo suelen ser días de noticias de alto impacto — identifícalos y evítalos.',
        ],
      },
    ],
    tips: [
      'Registra SIEMPRE tus operaciones el mismo día — la disciplina en el diario refleja la disciplina en el trading.',
      'Revisa el diario cada semana buscando patrones: ¿a qué hora pierdes más? ¿en qué tickers? ¿con qué setups?',
      'El objetivo no es un win rate perfecto, sino una relación riesgo/beneficio positiva consistente.',
    ],
  },
  {
    id: 'botsettings',
    icon: Settings,
    color: 'text-muted-foreground',
    bg: 'bg-secondary/50',
    border: 'border-border/50',
    title: 'Configuración',
    subtitle: 'Parámetros del sistema y gestión de riesgo',
    description: 'Centraliza todos los parámetros operativos del sistema: capital, límites de riesgo, estrategias habilitadas, y conexiones a servicios de notificación (Telegram, Discord, WhatsApp).',
    dataInputs: [
      { icon: Database, color: 'text-primary', label: 'Configuración persistente', detail: 'Los ajustes se guardan en base de datos y se cargan automáticamente en cada sesión.' },
    ],
    sections: [
      {
        title: 'Gestión de Riesgo',
        icon: Shield,
        color: 'text-red-400',
        explanation: 'Los parámetros más críticos del sistema. Una mala configuración de riesgo puede destruir una cuenta en días.',
        howToRead: [
          'Capital inicial: base para calcular el % de riesgo por operación.',
          'Pérdida máxima diaria: si alcanzas este número, para de operar. Sin excepciones.',
          'Operaciones máximas/día: limita el sobre-trading emocional. Recomendado: 3-5 max.',
          'Tamaño de posición: número de contratos/acciones por operación.',
          'Max Slippage: diferencia máxima aceptable entre el precio de orden y el de ejecución.',
        ],
      },
      {
        title: 'Módulos de Estrategia',
        icon: Layers,
        color: 'text-primary',
        explanation: 'Activa o desactiva estrategias específicas según el contexto de mercado actual.',
        howToRead: [
          'ORB duration: el timeframe que prefieres para el Opening Range (5, 15, 30 min o 1 hora).',
          'Gap direction: operar solo gaps a favor de tendencia, contra tendencia, o ambos.',
          'VWAP Bounce: estrategia de rebote en la VWAP. Mejor en mercados que no están en tendencia fuerte.',
          'Scalping/Intraday: habilita los módulos respectivos según tu estilo de trading.',
        ],
      },
    ],
    tips: [
      'Nunca arriesgues más del 1-2% de tu capital por operación.',
      'La pérdida máxima diaria debe ser equivalente a 2-3 operaciones perdedoras — si la alcanzas, para.',
      'Configura las alertas de Telegram/Discord para recibir señales aunque no estés mirando la pantalla.',
    ],
  },
];

function TabSection({ section }) {
  const Icon = section.icon;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${section.color}`} />
        <h4 className={`text-xs font-bold ${section.color}`}>{section.title}</h4>
      </div>
      <p className="text-xs text-muted-foreground pl-5">{section.explanation}</p>
      <ul className="space-y-1 pl-5">
        {section.howToRead.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[11px] text-foreground/80">
            <span className="text-primary mt-0.5 shrink-0">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TabCard({ tab }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = tab.icon;

  return (
    <Card className={`bg-card border ${tab.border} transition-all duration-200`}>
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${tab.bg} shrink-0`}>
              <Icon className={`w-5 h-5 ${tab.color}`} />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {tab.title}
                <Badge variant="outline" className={`text-[10px] ${tab.color} border-current`}>{tab.subtitle}</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{tab.description}</p>
            </div>
          </div>
          <button className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Data inputs always visible */}
        <div className="flex flex-wrap gap-2 mt-3 pl-11">
          {tab.dataInputs.map((d, i) => {
            const DIcon = d.icon;
            return (
              <div key={i} className="flex items-center gap-1.5 bg-secondary/60 rounded-full px-2.5 py-1 text-[10px]" title={d.detail}>
                <DIcon className={`w-3 h-3 ${d.color}`} />
                <span className="text-foreground/80">{d.label}</span>
              </div>
            );
          })}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t border-border/40 pt-4 space-y-5">
          {tab.sections.map((section, i) => (
            <TabSection key={i} section={section} />
          ))}

          {tab.tips && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1.5">
              <p className="text-[10px] font-bold text-primary uppercase tracking-wide flex items-center gap-1.5">
                <Brain className="w-3 h-3" />
                Tips del sistema
              </p>
              {tab.tips.map((tip, i) => (
                <p key={i} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                  <span className="text-primary shrink-0 mt-0.5">→</span>
                  {tip}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function Library() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-5 bg-card rounded-xl border border-border/50 flex items-start gap-4">
        <div className="p-3 rounded-xl bg-primary/10">
          <BookMarked className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Biblioteca del Sistema</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Guía completa de cada módulo: qué hace, qué datos usa y cómo interpretar los resultados.
            Haz clic en cualquier pestaña para expandir su documentación detallada.
          </p>
        </div>
      </div>

      {/* Tab cards */}
      <div className="space-y-4">
        {TABS.map((tab) => (
          <TabCard key={tab.id} tab={tab} />
        ))}
      </div>
    </div>
  );
}