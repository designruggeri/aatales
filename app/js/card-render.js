/*
 * MÖVAT! — disegna una carta Busa creata da un giocatore su un <canvas>.
 * Usato dall'app (anteprima in Crea, miniature e immagine da condividere in Scopri)
 * e dal CMS (revisione delle proposte, impostazione del template).
 *
 * Dati della carta: { title, dialect, translation, text }
 * Configurazione:   { template, ratio, layout, width, base, placeholders }
 *   template  immagine di sfondo (carta vuota con sfondo e camioncino), caricata dal CMS
 *   layout    posizioni in % dell'altezza/larghezza (vedi DEFAULT_LAYOUT)
 *   base      prefisso per i percorsi relativi ('' nell'app, '/' nel CMS)
 */
(function () {
  'use strict';

  const DEFAULT_LAYOUT = { titleY: 8, balloonTop: 14, balloonBottom: 40, tailX: 62, textTop: 62, textBottom: 93 };
  const INK = '#173a0c';
  const images = new Map();

  function loadImg(src) {
    if (!images.has(src)) {
      images.set(src, new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => { images.delete(src); reject(new Error('Immagine non caricata: ' + src)); };
        img.src = src;
      }));
    }
    return images.get(src);
  }
  let fontsLoading;
  function fontsReady() {
    if (!document.fonts) return Promise.resolve();
    return fontsLoading || (fontsLoading = Promise.all(
      ['800 40px "Baloo 2"', '700 40px "Baloo 2"', '600 20px "Nunito Sans"', 'italic 600 20px "Nunito Sans"', '700 20px "Nunito Sans"']
        .map((f) => document.fonts.load(f).catch(() => null)),
    ));
  }
  const url = (base, p) => (!p ? '' : /^(data:|blob:|https?:|\/)/.test(p) ? p : base + p);

  // Va a capo sulle parole; spezza le parole più lunghe della riga.
  function wrap(ctx, text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (let word of para.split(/\s+/).filter(Boolean)) {
        while (word.length > 1 && ctx.measureText(word).width > maxW) {
          let k = word.length - 1;
          while (k > 1 && ctx.measureText(word.slice(0, k)).width > maxW) k--;
          if (line) { out.push(line); line = ''; }
          out.push(word.slice(0, k)); word = word.slice(k);
        }
        const test = line ? line + ' ' + word : word;
        if (!line || ctx.measureText(test).width <= maxW) line = test;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    while (out.length > 1 && !out[out.length - 1]) out.pop();
    return out;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawFallbackBackground(ctx, W, H, truck) {
    const cx = W / 2, cy = H * 0.5;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#c6f36a'); g.addColorStop(1, '#6fb823');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = 'rgba(255,255,255,0.2)';
    const R = Math.max(W, H);
    for (let i = 0; i < 36; i += 2) {
      const a1 = (i / 36) * Math.PI * 2, a2 = ((i + 1) / 36) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a1) * R, Math.sin(a1) * R); ctx.lineTo(Math.cos(a2) * R, Math.sin(a2) * R); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (truck) {
      const tw = W * 0.56, th = tw * truck.naturalHeight / truck.naturalWidth;
      ctx.drawImage(truck, (W - tw) / 2, H * 0.395, tw, th);
    }
    ctx.lineWidth = W * 0.03; ctx.strokeStyle = '#fff';
    roundRect(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth, W * 0.07); ctx.stroke();
  }

  async function render(canvas, data = {}, cfg = {}) {
    const ratio = Number(cfg.ratio) || 63 / 88;
    const W = Math.round(cfg.width || 750), H = Math.round(W / ratio);
    const L = { ...DEFAULT_LAYOUT, ...(cfg.layout || {}) };
    const base = cfg.base || '';
    const ph = !!cfg.placeholders;
    await fontsReady();
    let tpl = null, truck = null;
    if (cfg.template) { try { tpl = await loadImg(url(base, cfg.template)); } catch { /* si usa lo sfondo automatico */ } }
    if (!tpl) { try { truck = await loadImg(url(base, 'assets/img/camioncino.png')); } catch { /* facoltativo */ } }

    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';

    // Sfondo: template caricato (ritagliato per riempire la carta) oppure sfondo automatico.
    if (tpl) {
      const s = Math.max(W / tpl.naturalWidth, H / tpl.naturalHeight);
      const dw = tpl.naturalWidth * s, dh = tpl.naturalHeight * s;
      ctx.drawImage(tpl, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else drawFallbackBackground(ctx, W, H, truck);

    // Titolo
    const titleRaw = data.title || (ph ? 'Titolo della carta' : '');
    if (titleRaw) {
      ctx.save(); if (!data.title) ctx.globalAlpha = 0.55;
      const title = titleRaw.toUpperCase();
      // Una riga se possibile; altrimenti due righe con un carattere un po' più piccolo.
      let size = W * 0.105, lines;
      for (; size > W * 0.05; size -= W * 0.004) {
        ctx.font = `800 ${size}px "Baloo 2", system-ui, sans-serif`;
        lines = wrap(ctx, title, W * 0.86);
        if (lines.length === 1 || (lines.length === 2 && size <= W * 0.08)) break;
      }
      const lh = size * 0.95;
      const y0 = (L.titleY / 100) * H + size * 0.35 - ((lines.length - 1) * lh) / 2;
      lines.forEach((ln, i) => {
        const y = y0 + i * lh;
        ctx.lineWidth = size * 0.2; ctx.strokeStyle = INK; ctx.strokeText(ln, W / 2, y);
        ctx.fillStyle = '#fff'; ctx.fillText(ln, W / 2, y);
      });
      ctx.restore();
    }

    // Balloon con frase in dialetto e traduzione: la dimensione si adatta al testo.
    const dia = data.dialect || (ph ? 'La frase che dice il camioncino' : '');
    const tra = data.translation || (ph ? 'La traduzione in italiano' : '');
    if (dia || tra) {
      const pad = W * 0.035, maxW = W * 0.84 - pad * 2;
      const top = (L.balloonTop / 100) * H, tailH = H * 0.04;
      const maxInner = (L.balloonBottom / 100) * H - top - pad * 2 - tailH;
      let s = W * 0.06, dl = [], tl = [], innerH = 0;
      for (; s >= W * 0.026; s -= W * 0.002) {
        ctx.font = `700 ${s}px "Baloo 2", system-ui, sans-serif`; dl = dia ? wrap(ctx, dia.toUpperCase(), maxW) : [];
        ctx.font = `italic 600 ${s * 0.68}px "Nunito Sans", system-ui, sans-serif`; tl = tra ? wrap(ctx, tra, maxW) : [];
        innerH = dl.length * s * 1.02 + (dl.length && tl.length ? s * 0.3 : 0) + tl.length * s * 0.68 * 1.25;
        if (innerH <= maxInner) break;
      }
      ctx.font = `700 ${s}px "Baloo 2", system-ui, sans-serif`;
      let widest = Math.max(0, ...dl.map((l) => ctx.measureText(l).width));
      ctx.font = `italic 600 ${s * 0.68}px "Nunito Sans", system-ui, sans-serif`;
      widest = Math.max(widest, ...tl.map((l) => ctx.measureText(l).width));
      const bw = Math.max(W * 0.5, widest + pad * 2), bh = innerH + pad * 2;
      const bx = (W - bw) / 2, by = top;
      const lw = W * 0.008;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowOffsetY = W * 0.008; ctx.shadowBlur = W * 0.012;
      ctx.fillStyle = '#fff'; roundRect(ctx, bx, by, bw, bh, W * 0.05); ctx.fill();
      ctx.restore();
      ctx.lineWidth = lw; ctx.strokeStyle = INK; roundRect(ctx, bx, by, bw, bh, W * 0.05); ctx.stroke();
      // Codina del fumetto verso il camioncino
      const tx = Math.min(Math.max((L.tailX / 100) * W, bx + W * 0.08), bx + bw - W * 0.08);
      const b1 = tx - W * 0.04, b2 = tx + W * 0.02, bottom = by + bh;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(b1, bottom - lw); ctx.lineTo(tx + W * 0.015, bottom + tailH); ctx.lineTo(b2, bottom - lw); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(b1, bottom); ctx.lineTo(tx + W * 0.015, bottom + tailH); ctx.lineTo(b2, bottom); ctx.stroke();
      ctx.fillRect(b1 + lw, bottom - lw * 1.5, b2 - b1 - lw * 2, lw * 2);
      // Testi
      let y = by + pad;
      ctx.save(); if (!data.dialect) ctx.globalAlpha = 0.5;
      ctx.fillStyle = INK; ctx.font = `700 ${s}px "Baloo 2", system-ui, sans-serif`;
      dl.forEach((ln) => { y += s * 1.02; ctx.fillText(ln, W / 2, y - s * 0.2); });
      ctx.restore();
      if (dl.length && tl.length) y += s * 0.3;
      ctx.save(); if (!data.translation) ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#3d4a39'; ctx.font = `italic 600 ${s * 0.68}px "Nunito Sans", system-ui, sans-serif`;
      tl.forEach((ln) => { y += s * 0.68 * 1.25; ctx.fillText(ln, W / 2, y - s * 0.68 * 0.3); });
      ctx.restore();
    }

    // Riquadro con il testo della carta
    const txt = data.text || (ph ? 'Il testo della carta: cosa succede quando la giochi.' : '');
    if (txt) {
      const x = W * 0.07, w = W * 0.86, y0 = (L.textTop / 100) * H, h = (L.textBottom / 100) * H - y0;
      const pad = W * 0.04;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.15)'; ctx.shadowOffsetY = W * 0.006; ctx.shadowBlur = W * 0.01;
      ctx.fillStyle = 'rgba(255,255,255,0.96)'; roundRect(ctx, x, y0, w, h, W * 0.05); ctx.fill();
      ctx.restore();
      let s = W * 0.052, lines = [];
      for (; s >= W * 0.024; s -= W * 0.002) {
        ctx.font = `600 ${s}px "Nunito Sans", system-ui, sans-serif`;
        lines = wrap(ctx, txt, w - pad * 2);
        if (lines.length * s * 1.25 <= h - pad * 2) break;
      }
      const blockH = lines.length * s * 1.25;
      let y = y0 + (h - blockH) / 2;
      ctx.save(); if (!data.text) ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#182317';
      ctx.beginPath(); ctx.rect(x, y0, w, h); ctx.clip();
      lines.forEach((ln) => { y += s * 1.25; ctx.fillText(ln, W / 2, y - s * 0.3); });
      ctx.restore();
    }
    return canvas;
  }

  async function toBlob(data, cfg = {}, type = 'image/png', quality = 0.92) {
    const c = await render(document.createElement('canvas'), data, { ...cfg, width: cfg.width || 1080 });
    return new Promise((resolve) => c.toBlob(resolve, type, quality));
  }
  async function toDataURL(data, cfg = {}, type = 'image/png', quality = 0.9) {
    const c = await render(document.createElement('canvas'), data, cfg);
    return c.toDataURL(type, quality);
  }

  window.MovatCardRender = { render, toBlob, toDataURL, DEFAULT_LAYOUT };
})();
