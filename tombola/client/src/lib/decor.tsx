// Decorazioni vettoriali (agrifoglio, pacco Busa) e camioncino Busa. Le decorazioni natalizie si disattivano dal CMS.
import truck from '../assets/camioncino.png';

export const TRUCK_SRC = truck;

export function Holly({ size = 64, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={style} aria-hidden="true">
      <path d="M30 34c-6-10-18-12-26-8 6 2 6 8 2 12 8-2 14 2 16 8 2-6 6-10 8-12z" fill="#1e7a2e" stroke="#0f4d1b" strokeWidth="1.5" />
      <path d="M34 34c6-10 18-12 26-8-6 2-6 8-2 12-8-2-14 2-16 8-2-6-6-10-8-12z" fill="#2c9a3c" stroke="#0f4d1b" strokeWidth="1.5" />
      <circle cx="27" cy="30" r="6" fill="#d7262b" />
      <circle cx="37" cy="30" r="6" fill="#e8432c" />
      <circle cx="32" cy="22" r="6" fill="#c41d22" />
      <circle cx="30" cy="20" r="1.8" fill="#fff" opacity=".7" />
    </svg>
  );
}

/** Camioncino Busa (asset originale, già con il cappello natalizio) con la molla animata. */
export function Truck({ width = 220, bounce = true }: { width?: number; christmas?: boolean; bounce?: boolean }) {
  return (
    <div className={`truck-wrap ${bounce ? 'bounce' : ''}`} style={{ width, position: 'relative' }}>
      <img src={truck} alt="Camioncino Busa" style={{ width: '100%', display: 'block' }} draggable={false} />
    </div>
  );
}

/** Pacco regalo verde Busa con coperchio separato per l'apertura animata. */
export function GiftBox({ open, size = 300 }: { open: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={`gift ${open ? 'open' : ''}`} aria-hidden="true">
      <defs>
        <linearGradient id="gbody" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#5fc23a" />
          <stop offset="1" stopColor="#2f8a22" />
        </linearGradient>
      </defs>
      <g className="gift-glow">
        <circle cx="100" cy="110" r="70" fill="#fff6c2" opacity=".0" />
      </g>
      <g className="gift-body">
        <rect x="30" y="92" width="140" height="96" rx="8" fill="url(#gbody)" stroke="#1f6b2a" strokeWidth="3" />
        <rect x="88" y="92" width="24" height="96" fill="#d7262b" />
        <text x="100" y="160" textAnchor="middle" fontFamily="Lato" fontWeight="900" fontSize="26" fill="#fff" letterSpacing="2">BUSA</text>
      </g>
      <g className="gift-lid">
        <rect x="22" y="68" width="156" height="30" rx="6" fill="#52ae32" stroke="#1f6b2a" strokeWidth="3" />
        <rect x="88" y="68" width="24" height="30" fill="#e8432c" />
        <path d="M100 68 C80 40 54 46 64 62 C70 70 92 70 100 68 Z" fill="#e8432c" stroke="#a3251a" strokeWidth="2" />
        <path d="M100 68 C120 40 146 46 136 62 C130 70 108 70 100 68 Z" fill="#e8432c" stroke="#a3251a" strokeWidth="2" />
      </g>
    </svg>
  );
}

export function Lights() {
  const colors = ['#e8432c', '#ffcc33', '#52ae32', '#e8432c', '#ffcc33', '#52ae32', '#e8432c', '#ffcc33', '#52ae32', '#e8432c'];
  return (
    <svg className="lights" viewBox="0 0 400 34" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 6 Q20 22 40 6 T80 6 T120 6 T160 6 T200 6 T240 6 T280 6 T320 6 T360 6 T400 6" stroke="#0f3d16" strokeWidth="1.5" fill="none" />
      {colors.map((c, i) => (
        <ellipse key={i} cx={20 + i * 40} cy={21} rx={5} ry={8} fill={c} style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
    </svg>
  );
}
