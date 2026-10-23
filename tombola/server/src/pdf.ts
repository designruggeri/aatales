// Export PDF vettoriale delle cartelle, con Lato incorporato. Numeri e codici arrivano dagli stessi record del database.
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { FONT, TRUCK_PNG } from './paths.js';
import type { CardRow } from './cards.js';

export interface PrintProfile {
  /** Abbondanza per lato (mm), solo nel formato A6. */
  bleedMm: number;
  /** Margine di sicurezza interno (mm): nessun testo oltre questo limite. */
  safetyMm: number;
  cropMarks: boolean;
  /** Aggiunge il retro (uguale per tutte le cartelle). */
  back: boolean;
  qr: boolean;
  /** Prefisso facoltativo del QR, es. http://192.168.1.10:8080/control#verifica= (vuoto = solo codice). */
  qrPrefix: string;
}
export const DEFAULT_PROFILE: PrintProfile = { bleedMm: 0, safetyMm: 5, cropMarks: false, back: false, qr: true, qrPrefix: '' };

export function sanitizeProfile(p: Partial<PrintProfile> | undefined): PrintProfile {
  const n = (v: unknown, d: number, lo: number, hi: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  };
  return {
    bleedMm: n(p?.bleedMm, DEFAULT_PROFILE.bleedMm, 0, 5),
    safetyMm: n(p?.safetyMm, DEFAULT_PROFILE.safetyMm, 3, 10),
    cropMarks: typeof p?.cropMarks === 'boolean' ? p.cropMarks : DEFAULT_PROFILE.cropMarks,
    back: typeof p?.back === 'boolean' ? p.back : DEFAULT_PROFILE.back,
    qr: typeof p?.qr === 'boolean' ? p.qr : DEFAULT_PROFILE.qr,
    qrPrefix: typeof p?.qrPrefix === 'string' ? p.qrPrefix.trim().slice(0, 200) : '',
  };
}

const MM = 72 / 25.4;
export const CARD_W = 148;
export const CARD_H = 105;
const A4_W = 297;
const A4_H = 210;
const GREEN = '#52AE32';
const DARK = '#1F6B2A';
const TINT = '#E9F5E1';

export interface PdfOptions {
  format: 'a6' | 'a4';
  profile: PrintProfile;
  title: string;
  subtitle: string;
  colors?: { primary: string; dark: string };
  logoPng?: Buffer | null;
}

/** Disegna una cartella con l'angolo in alto a sinistra del formato finale in (ox, oy), in mm. */
function drawCard(doc: PDFKit.PDFDocument, card: CardRow, ox: number, oy: number, opt: PdfOptions, fullBleed: number) {
  const p = opt.profile;
  const s = p.safetyMm;
  const green = opt.colors?.primary ?? GREEN;
  const dark = opt.colors?.dark ?? DARK;
  const X = (mm: number) => (ox + mm) * MM;
  const Y = (mm: number) => (oy + mm) * MM;

  // Fascia superiore: a pieno formato con abbondanza, altrimenti rientrata nel margine di sicurezza.
  const headerH = 22;
  doc.save();
  if (fullBleed > 0) {
    doc.rect(X(-fullBleed), Y(-fullBleed), (CARD_W + 2 * fullBleed) * MM, (headerH + fullBleed + s) * MM).fill(green);
  } else {
    doc.roundedRect(X(s), Y(s), (CARD_W - 2 * s) * MM, headerH * MM, 3 * MM).fill(green);
  }
  doc.restore();
  const hTop = fullBleed > 0 ? 0 : s;
  const hBottom = fullBleed > 0 ? headerH + s : s + headerH;

  // Camioncino Busa (immagine originale) e titolo.
  const truckH = 15;
  const truckW = truckH * (800 / 428);
  if (fs.existsSync(TRUCK_PNG)) doc.image(TRUCK_PNG, X(s + 2), Y(hBottom - truckH - 2), { height: truckH * MM });
  const titleX = s + 2 + truckW + 2;
  doc.fillColor('#FFFFFF').font('black').fontSize(19).text(opt.title.toUpperCase(), X(titleX), Y(hTop + s + 2.2), { lineBreak: false });
  doc.font('bold').fontSize(8.5).text(opt.subtitle, X(titleX), Y(hTop + s + 10.5), { lineBreak: false, width: 60 * MM, ellipsis: true });

  // Codice grande nel riquadro bianco.
  const codeW = 34;
  const cx = CARD_W - s - codeW - 2;
  doc.roundedRect(X(cx), Y(hBottom - 18), codeW * MM, 15 * MM, 2.5 * MM).fill('#FFFFFF');
  doc.fillColor(dark).font('bold').fontSize(6.5).text('CARTELLA', X(cx), Y(hBottom - 16.6), { width: codeW * MM, align: 'center', lineBreak: false });
  doc.font('black').fontSize(19).text(card.code, X(cx), Y(hBottom - 13.4), { width: codeW * MM, align: 'center', lineBreak: false });

  // Griglia 3 × 9.
  const gx = s + 1;
  const gy = hBottom + 3;
  const gw = CARD_W - 2 * s - 2;
  const cellW = gw / 9;
  const cellH = 16.2;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 9; c++) {
      const n = card.matrix[r][c];
      const x = gx + c * cellW;
      const y = gy + r * cellH;
      doc.save();
      doc.roundedRect(X(x + 0.5), Y(y + 0.5), (cellW - 1) * MM, (cellH - 1) * MM, 1.6 * MM);
      if (n) doc.lineWidth(1.1).fillAndStroke('#FFFFFF', green);
      else doc.fill(TINT);
      doc.restore();
      if (n) {
        doc.fillColor(dark).font('black').fontSize(25);
        doc.text(String(n), X(x), Y(y + cellH / 2 - 4.4), { width: cellW * MM, align: 'center', lineBreak: false });
      }
    }
  }

  // Piede: regola, lotto, ristampa e QR facoltativo.
  const fy = gy + 3 * cellH + 2.5;
  const qrSize = 14;
  const qrShown = p.qr;
  doc.fillColor(dark).font('bold').fontSize(7.2);
  doc.text('Una sola vincita per riga · Tombola sempre valida', X(s + 1), Y(fy), { lineBreak: false });
  doc.font('normal').fontSize(6.5).fillColor('#3d4a3d');
  const reprint = card.printCount > 0 ? `  ·  RISTAMPA n. ${card.printCount + 1} (stessa cartella)` : '';
  doc.text(`Cartella ${card.code}  ·  Lotto ${card.code.replace(/\d+$/, '')}${reprint}`, X(s + 1), Y(fy + 4), { lineBreak: false });
  if (qrShown) {
    const qr = QRCode.create(`${p.qrPrefix}${card.code}`, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const mod = qrSize / size;
    const qx = CARD_W - s - qrSize;
    const qy = CARD_H - s - qrSize;
    doc.save().fillColor('#000000');
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (qr.modules.get(r, c)) doc.rect(X(qx + c * mod), Y(qy + r * mod), mod * MM + 0.05, mod * MM + 0.05);
      }
    }
    doc.fill();
    doc.restore();
  }
}

function drawBack(doc: PDFKit.PDFDocument, ox: number, oy: number, opt: PdfOptions, fullBleed: number) {
  const s = opt.profile.safetyMm;
  const green = opt.colors?.primary ?? GREEN;
  const X = (mm: number) => (ox + mm) * MM;
  const Y = (mm: number) => (oy + mm) * MM;
  doc.save();
  if (fullBleed > 0) doc.rect(X(-fullBleed), Y(-fullBleed), (CARD_W + 2 * fullBleed) * MM, (CARD_H + 2 * fullBleed) * MM).fill(green);
  else doc.roundedRect(X(s), Y(s), (CARD_W - 2 * s) * MM, (CARD_H - 2 * s) * MM, 4 * MM).fill(green);
  doc.restore();
  if (opt.logoPng) {
    try {
      doc.image(opt.logoPng, X(CARD_W / 2 - 25), Y(14), { fit: [50 * MM, 18 * MM], align: 'center' });
    } catch {
      /* logo non leggibile: si stampa senza */
    }
  }
  if (fs.existsSync(TRUCK_PNG)) doc.image(TRUCK_PNG, X(CARD_W / 2 - 28), Y(36), { width: 56 * MM });
  doc.fillColor('#FFFFFF').font('black').fontSize(22).text(opt.title.toUpperCase(), X(0), Y(CARD_H - s - 16), { width: CARD_W * MM, align: 'center', lineBreak: false });
}

function cropMarksAround(doc: PDFKit.PDFDocument, ox: number, oy: number, offset: number) {
  // Segni di taglio fuori dal formato finale, distanti "offset" mm dal bordo.
  const L = 5;
  const lines: [number, number, number, number][] = [];
  for (const [cx, cy, dx, dy] of [
    [0, 0, -1, -1],
    [CARD_W, 0, 1, -1],
    [0, CARD_H, -1, 1],
    [CARD_W, CARD_H, 1, 1],
  ] as const) {
    lines.push([cx + dx * offset, cy, cx + dx * (offset + L), cy]);
    lines.push([cx, cy + dy * offset, cx, cy + dy * (offset + L)]);
  }
  doc.save().lineWidth(0.25).strokeColor('#000000');
  for (const [x1, y1, x2, y2] of lines) doc.moveTo((ox + x1) * MM, (oy + y1) * MM).lineTo((ox + x2) * MM, (oy + y2) * MM);
  doc.stroke().restore();
}

export interface PdfLayoutInfo {
  pageWidthMm: number;
  pageHeightMm: number;
  pages: number;
  note: string;
}

export function layoutInfo(format: 'a6' | 'a4', profile: PrintProfile, cards: number): PdfLayoutInfo {
  if (format === 'a6') {
    const m = Math.max(profile.bleedMm, profile.cropMarks ? 3 + 5 + 1 : 0);
    return {
      pageWidthMm: CARD_W + 2 * m,
      pageHeightMm: CARD_H + 2 * m,
      pages: cards * (profile.back ? 2 : 1),
      note: m
        ? `Pagina ${CARD_W + 2 * m} × ${CARD_H + 2 * m} mm: formato finale ${CARD_W} × ${CARD_H} mm centrato, abbondanza ${profile.bleedMm} mm per lato.`
        : `Pagina e formato finale ${CARD_W} × ${CARD_H} mm (A6 orizzontale).`,
    };
  }
  const sheets = Math.ceil(cards / 4);
  return {
    pageWidthMm: A4_W,
    pageHeightMm: A4_H,
    pages: sheets * (profile.back ? 2 : 1),
    note: `A4 orizzontale ${A4_W} × ${A4_H} mm, 4 cartelle diverse per foglio. Ogni quarto misura 148,5 × 105 mm: la cartella (148 × 105 mm) è centrata senza deformazioni, con 0,25 mm bianchi a sinistra e a destra. Taglio a 148,5 mm e a 105 mm; nessuna abbondanza fra cartelle adiacenti.`,
  };
}

export function renderCardsPdf(cards: CardRow[], opt: PdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = opt.profile;
    const info = layoutInfo(opt.format, p, cards.length);
    const doc = new PDFDocument({
      size: [info.pageWidthMm * MM, info.pageHeightMm * MM],
      margin: 0,
      autoFirstPage: false,
      info: { Title: `${opt.title} — cartelle`, Author: 'Tombola Busa', Subject: info.note },
    });
    doc.registerFont('normal', FONT.normal);
    doc.registerFont('bold', FONT.bold);
    doc.registerFont('black', FONT.black);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (opt.format === 'a6') {
      const m = (info.pageWidthMm - CARD_W) / 2;
      for (const card of cards) {
        doc.addPage();
        drawCard(doc, card, m, m, opt, p.bleedMm);
        if (p.cropMarks && m > 0) cropMarksAround(doc, m, m, Math.max(p.bleedMm, 3));
        if (p.back) {
          doc.addPage();
          drawBack(doc, m, m, opt, p.bleedMm);
          if (p.cropMarks && m > 0) cropMarksAround(doc, m, m, Math.max(p.bleedMm, 3));
        }
      }
    } else {
      const cellW = A4_W / 2;
      const offX = (cellW - CARD_W) / 2; // 0,25 mm
      const slots = [
        [0, 0],
        [cellW, 0],
        [0, CARD_H],
        [cellW, CARD_H],
      ];
      for (let i = 0; i < cards.length; i += 4) {
        const group = cards.slice(i, i + 4);
        doc.addPage();
        group.forEach((card, k) => drawCard(doc, card, slots[k][0] + offX, slots[k][1], opt, 0));
        if (p.cropMarks) {
          // Tacche di taglio sui bordi del foglio, dentro il margine di sicurezza.
          doc.save().lineWidth(0.4).strokeColor('#000000');
          doc.moveTo(cellW * MM, 0).lineTo(cellW * MM, 3 * MM);
          doc.moveTo(cellW * MM, A4_H * MM).lineTo(cellW * MM, (A4_H - 3) * MM);
          doc.moveTo(0, CARD_H * MM).lineTo(3 * MM, CARD_H * MM);
          doc.moveTo(A4_W * MM, CARD_H * MM).lineTo((A4_W - 3) * MM, CARD_H * MM);
          doc.stroke().restore();
        }
        if (p.back) {
          doc.addPage();
          group.forEach((_, k) => drawBack(doc, slots[k][0] + offX, slots[k][1], opt, 0));
        }
      }
    }
    doc.end();
  });
}
