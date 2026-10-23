// Decorazioni vettoriali (agrifoglio, cappello di Babbo Natale, pacco Busa). Tutte disattivabili dal CMS.
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

export function SantaHat({ size = 90, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 100 80" style={style} aria-hidden="true">
      <path d="M12 60 C20 20 50 2 78 14 C90 20 92 34 86 44 L80 40 C76 30 66 28 60 34 L88 60 Z" fill="#d7262b" />
      <path d="M40 18 C56 8 72 10 80 18" stroke="#ff6b5e" strokeWidth="4" fill="none" opacity=".5" />
      <rect x="6" y="56" width="88" height="16" rx="8" fill="#fff" />
      <circle cx="86" cy="46" r="10" fill="#fff" />
    </svg>
  );
}

/** Camioncino Busa (asset originale) con molla e, se attivo, cappello natalizio. */
export function Truck({ width = 220, christmas, bounce = true }: { width?: number; christmas: boolean; bounce?: boolean }) {
  return (
    <div className={`truck-wrap ${bounce ? 'bounce' : ''}`} style={{ width, position: 'relative' }}>
      <img src={truck} alt="Camioncino Busa" style={{ width: '100%', display: 'block' }} draggable={false} />
      {christmas && <SantaHat size={width * 0.36} style={{ position: 'absolute', left: width * 0.55, top: -width * 0.17, transform: 'rotate(14deg)' }} />}
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
