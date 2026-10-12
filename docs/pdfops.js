'use strict';
/* pdf-lib 기반 저장·페이지 작업 */
const { PDFDocument, StandardFonts, rgb, degrees, BlendMode, LineCapStyle, PDFHexString, PDFString, PDFName } = PDFLib;

const OPS = {
  fonts: null, // { regular: Uint8Array, bold: Uint8Array|null }

  async loadFonts() {
    if (this.fonts !== null) return this.fonts;
    try {
      const r = await window.host.systemFont();
      this.fonts = r ? { regular: r.data, bold: r.bold || null } : { regular: null, bold: null };
    } catch { this.fonts = { regular: null, bold: null }; }
    return this.fonts;
  },

  isEncryptedError(e) { return /encrypt/i.test(String(e && (e.message || e))); },

  async load(bytes) {
    return PDFDocument.load(bytes, { updateMetadata: false });
  },

  hex(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || '#000000');
    const n = m ? parseInt(m[1], 16) : 0;
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  },

  // 문서 하나에 쓸 글꼴 묶음을 만든다 (한글 지원 시스템 글꼴 → 없으면 Helvetica)
  async fontKit(doc) {
    const fonts = await this.loadFonts();
    const kit = { regular: null, bold: null, unicode: false };
    if (fonts.regular) {
      try {
        doc.registerFontkit(window.fontkit);
        kit.regular = await doc.embedFont(fonts.regular, { subset: true });
        kit.bold = fonts.bold ? await doc.embedFont(fonts.bold, { subset: true }) : kit.regular;
        kit.unicode = true;
      } catch (e) { console.warn('시스템 글꼴 포함 실패', e); }
    }
    if (!kit.regular) {
      kit.regular = await doc.embedFont(StandardFonts.Helvetica);
      kit.bold = await doc.embedFont(StandardFonts.HelveticaBold);
    }
    return kit;
  },

  safeText(kit, s) {
    if (kit.unicode) return s;
    // WinAnsi 밖 문자는 표준 글꼴로 그릴 수 없음
    return String(s).replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
  },

  wrap(font, text, size, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!maxW || maxW <= 0) { out.push(para); continue; }
      let line = '';
      const tokens = para.match(/\s+|[^\sㄱ-힣一-鿿぀-ヿ]+|[ㄱ-힣一-鿿぀-ヿ]/g) || [''];
      for (const tok of tokens) {
        const cand = line + tok;
        let w; try { w = font.widthOfTextAtSize(cand, size); } catch { w = cand.length * size * 0.6; }
        if (w <= maxW || !line) { line = cand; }
        else { out.push(line.replace(/\s+$/, '')); line = tok.replace(/^\s+/, ''); }
        // 한 토큰이 너무 길면 글자 단위로 자른다
        while (line.length > 1) {
          let lw; try { lw = font.widthOfTextAtSize(line, size); } catch { lw = line.length * size * 0.6; }
          if (lw <= maxW) break;
          let cut = line.length - 1;
          while (cut > 1) { let cw; try { cw = font.widthOfTextAtSize(line.slice(0, cut), size); } catch { cw = cut * size * 0.6; } if (cw <= maxW) break; cut--; }
          out.push(line.slice(0, cut)); line = line.slice(cut);
        }
      }
      out.push(line);
    }
    return out;
  },

  dataUrlBytes(src) {
    const i = src.indexOf(',');
    const bin = atob(src.slice(i + 1));
    const u = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    return { bytes: u, jpeg: /^data:image\/jpe?g/i.test(src) };
  },

  /* 주석을 페이지에 그려 넣는다. annots: { [pageIndex]: obj[] } */
  async flatten(baseBytes, annots, meta) {
    const doc = await this.load(baseBytes);
    const pages = doc.getPages();
    const needsFont = Object.values(annots).some(list => list.some(o => ['text', 'edittext', 'stamp'].includes(o.type)));
    const kit = needsFont ? await this.fontKit(doc) : null;
    const imgCache = new Map();

    for (const key of Object.keys(annots)) {
      const page = pages[+key];
      if (!page) continue;
      const cb = page.getCropBox();
      const X0 = cb.x, TOP = cb.y + cb.height;
      const px = (x) => X0 + x, py = (y) => TOP - y;
      const svgOpt = { x: X0, y: TOP };

      for (const o of annots[key]) {
        const op = o.opacity ?? 1;
        const color = this.hex(o.color);
        switch (o.type) {
          case 'highlight':
            for (const [x, y, w, h] of o.rects) {
              page.drawRectangle({ x: px(x), y: py(y + h), width: w, height: h, color, opacity: op, blendMode: BlendMode.Multiply });
            }
            break;
          case 'underline': case 'strike':
            for (const [x, y, w, h] of o.rects) {
              const th = Math.max(0.8, h * 0.075);
              const yy = o.type === 'underline' ? y + h - th / 2 : y + h * 0.55;
              page.drawLine({ start: { x: px(x), y: py(yy) }, end: { x: px(x + w), y: py(yy) }, thickness: th, color, opacity: op });
            }
            break;
          case 'ink':
            page.drawSvgPath(ANN.inkPath(o.pts), { ...svgOpt, borderColor: color, borderWidth: o.width, borderOpacity: op, borderLineCap: LineCapStyle.Round });
            break;
          case 'rect':
            page.drawRectangle({ x: px(o.x), y: py(o.y + o.h), width: o.w, height: o.h, borderColor: color, borderWidth: o.width, borderOpacity: op, color: o.fill ? this.hex(o.fill) : undefined, opacity: o.fill ? op : undefined });
            break;
          case 'whiteout':
            page.drawRectangle({ x: px(o.x), y: py(o.y + o.h), width: o.w, height: o.h, color: rgb(1, 1, 1) });
            break;
          case 'ellipse':
            page.drawEllipse({ x: px(o.x + o.w / 2), y: py(o.y + o.h / 2), xScale: o.w / 2, yScale: o.h / 2, borderColor: color, borderWidth: o.width, borderOpacity: op, color: o.fill ? this.hex(o.fill) : undefined, opacity: o.fill ? op : undefined });
            break;
          case 'line': case 'arrow':
            page.drawLine({ start: { x: px(o.x1), y: py(o.y1) }, end: { x: px(o.x2), y: py(o.y2) }, thickness: o.width, color, opacity: op, lineCap: LineCapStyle.Round });
            if (o.type === 'arrow') page.drawSvgPath(ANN.arrowHead(o), { ...svgOpt, borderColor: color, borderWidth: o.width, borderOpacity: op, borderLineCap: LineCapStyle.Round });
            break;
          case 'text': case 'edittext': {
            if (o.type === 'edittext' && o.cover) page.drawRectangle({ x: px(o.cover.x), y: py(o.cover.y + o.cover.h), width: o.cover.w, height: o.cover.h, color: rgb(1, 1, 1) });
            if (o.type === 'text' && o.bg) page.drawRectangle({ x: px(o.x), y: py(o.y + o.h), width: o.w, height: o.h, color: this.hex(o.bg) });
            if (o.type === 'text' && o.border) page.drawRectangle({ x: px(o.x), y: py(o.y + o.h), width: o.w, height: o.h, borderColor: color, borderWidth: 1 });
            const font = o.bold ? kit.bold : kit.regular;
            const pad = o.type === 'text' ? 2 : 0;
            const fs = o.fontSize;
            const text = this.safeText(kit, o.text || '');
            const lines = o.type === 'text' ? this.wrap(font, text, fs, o.w - pad * 2 + 0.5) : text.split('\n');
            const lh = fs * 1.2;
            lines.forEach((ln, i) => {
              if (!ln) return;
              const base = o.y + pad + i * lh + fs * 0.1 + fs * 0.88;
              page.drawText(ln, { x: px(o.x + pad), y: py(base), size: fs, font, color });
            });
            break;
          }
          case 'stamp': {
            const sw = Math.max(1.5, o.h * 0.055);
            page.drawSvgPath(ANN.roundRectPath(o.x, o.y, o.w, o.h, Math.min(8, o.h * 0.18)), { ...svgOpt, borderColor: color, borderWidth: sw, borderOpacity: op });
            const sub = ANN.stampSub(o);
            const s1 = o.h * (sub ? 0.4 : 0.46);
            const label = this.safeText(kit, o.label);
            const w1 = kit.bold.widthOfTextAtSize(label, s1);
            page.drawText(label, { x: px(o.x + o.w / 2) - w1 / 2, y: py(o.y + (sub ? o.h * 0.52 : o.h * 0.64)), size: s1, font: kit.bold, color, opacity: op });
            if (sub) {
              const s2 = o.h * 0.18, t2 = this.safeText(kit, sub);
              const w2 = kit.regular.widthOfTextAtSize(t2, s2);
              page.drawText(t2, { x: px(o.x + o.w / 2) - w2 / 2, y: py(o.y + o.h * 0.82), size: s2, font: kit.regular, color, opacity: op });
            }
            break;
          }
          case 'image': case 'signature': {
            let img = imgCache.get(o.src);
            if (!img) {
              const { bytes, jpeg } = this.dataUrlBytes(o.src);
              img = jpeg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
              imgCache.set(o.src, img);
            }
            page.drawImage(img, { x: px(o.x), y: py(o.y + o.h), width: o.w, height: o.h, opacity: op });
            break;
          }
          case 'note': {
            const c = this.hex(o.color || '#ffd400');
            const annot = doc.context.obj({
              Type: 'Annot', Subtype: 'Text',
              Rect: [px(o.x), py(o.y + 20), px(o.x + 20), py(o.y)],
              Contents: PDFHexString.fromText(o.text || ''),
              T: PDFHexString.fromText(o.author || ''),
              M: PDFString.fromDate(new Date(o.modified || o.created || Date.now())),
              Name: 'Comment', F: 4, Open: false,
              C: [c.red, c.green, c.blue],
            });
            page.node.addAnnot(doc.context.register(annot));
            break;
          }
        }
      }
    }
    if (meta) {
      if (meta.title != null) doc.setTitle(meta.title);
      if (meta.author != null) doc.setAuthor(meta.author);
      if (meta.subject != null) doc.setSubject(meta.subject);
      if (meta.keywords != null) doc.setKeywords(meta.keywords.split(/[,;]\s*/).filter(Boolean));
    }
    doc.setModificationDate(new Date());
    doc.setProducer('Basic PDF');
    return doc.save();
  },

  /* 페이지 재구성. entries: [{src, rot} | {blank:[w,h], rot} | {ext:{key,index}, rot}] */
  async reorganize(baseBytes, entries, extBytes = {}) {
    const doc = await this.load(baseBytes);
    const pages = doc.getPages();
    const origRot = pages.map(p => p.getRotation().angle || 0);
    for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
    const extDocs = {};
    for (const e of entries) {
      let page, base = 0;
      if (e.src != null) { page = pages[e.src]; base = origRot[e.src]; doc.addPage(page); }
      else if (e.blank) { page = doc.addPage(e.blank); }
      else if (e.ext) {
        if (!extDocs[e.ext.key]) extDocs[e.ext.key] = await this.load(extBytes[e.ext.key]);
        const src = extDocs[e.ext.key];
        [page] = await doc.copyPages(src, [e.ext.index]);
        base = src.getPage(e.ext.index).getRotation().angle || 0;
        doc.addPage(page);
      }
      const r = (((base + (e.rot || 0)) % 360) + 360) % 360;
      page.setRotation(degrees(r));
    }
    return doc.save();
  },

  async merge(list) {
    const out = await PDFDocument.create();
    for (const bytes of list) {
      const src = await this.load(bytes);
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach(p => out.addPage(p));
    }
    return out.save();
  },

  async extract(baseBytes, indices) {
    const src = await this.load(baseBytes);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indices);
    copied.forEach(p => out.addPage(p));
    return out.save();
  },

  // 화면 기준 좌표 (왼쪽 위, 회전 적용) → PDF 사용자 좌표
  displayToUser(page, dx, dy) {
    const cb = page.getCropBox();
    const r = ((page.getRotation().angle || 0) % 360 + 360) % 360;
    const { x: x0, y: y0, width: W, height: H } = cb;
    switch (r) {
      case 90: return { x: x0 + dy, y: y0 + dx, rot: 90, dw: H, dh: W };
      case 180: return { x: x0 + W - dx, y: y0 + dy, rot: 180, dw: W, dh: H };
      case 270: return { x: x0 + W - dy, y: y0 + H - dx, rot: 270, dw: H, dh: W };
      default: return { x: x0 + dx, y: y0 + H - dy, rot: 0, dw: W, dh: H };
    }
  },

  displaySize(page) {
    const cb = page.getCropBox();
    const r = ((page.getRotation().angle || 0) % 360 + 360) % 360;
    return (r === 90 || r === 270) ? { w: cb.height, h: cb.width } : { w: cb.width, h: cb.height };
  },

  async pageNumbers(baseBytes, o) {
    const doc = await this.load(baseBytes);
    const kit = await this.fontKit(doc);
    const pages = doc.getPages(), total = pages.length;
    const from = Math.max(1, o.from || 1), to = Math.min(total, o.to || total);
    const color = this.hex(o.color || '#333333');
    for (let i = from - 1; i < to; i++) {
      const page = pages[i];
      const n = (o.start || 1) + (i - (from - 1));
      const t = this.safeText(kit, o.format.replace('{n}', n).replace('{t}', (o.start || 1) + (to - from)));
      const size = o.size || 10;
      const w = kit.regular.widthOfTextAtSize(t, size);
      const { w: DW, h: DH } = this.displaySize(page);
      const m = o.margin ?? 28;
      const [v, hz] = o.position.split('');
      const dx = hz === 'l' ? m : hz === 'r' ? DW - m - w : (DW - w) / 2;
      const dy = v === 't' ? m + size * 0.8 : DH - m;
      const u = this.displayToUser(page, dx, dy);
      page.drawText(t, { x: u.x, y: u.y, size, font: kit.regular, color, rotate: degrees(u.rot) });
    }
    return doc.save();
  },

  async watermark(baseBytes, o) {
    const doc = await this.load(baseBytes);
    const kit = await this.fontKit(doc);
    const color = this.hex(o.color || '#d4382c');
    const text = this.safeText(kit, o.text);
    const font = kit.bold;
    for (const page of doc.getPages()) {
      const cb = page.getCropBox();
      const r = ((page.getRotation().angle || 0) % 360 + 360) % 360;
      const { w: DW, h: DH } = this.displaySize(page);
      let size = o.size || 60;
      const tw0 = font.widthOfTextAtSize(text, size);
      const diag = o.angle ? Math.hypot(DW, DH) * 0.8 : DW * 0.85;
      if (o.fit && tw0 > diag) size = size * diag / tw0;
      const tw = font.widthOfTextAtSize(text, size);
      const a = ((r + (o.angle || 0)) * Math.PI) / 180;
      const cx = cb.x + cb.width / 2, cy = cb.y + cb.height / 2;
      const hh = size * 0.35;
      const x = cx - (tw / 2) * Math.cos(a) + hh * Math.sin(a);
      const y = cy - (tw / 2) * Math.sin(a) - hh * Math.cos(a);
      page.drawText(text, { x, y, size, font, color, opacity: o.opacity ?? 0.25, rotate: degrees(r + (o.angle || 0)) });
    }
    return doc.save();
  },

  async fromImages(images) {
    // images: [{ bytes(jpeg), w, h (pt) }]
    const out = await PDFDocument.create();
    for (const im of images) {
      const img = await out.embedJpg(im.bytes);
      const p = out.addPage([im.w, im.h]);
      p.drawImage(img, { x: 0, y: 0, width: im.w, height: im.h });
    }
    return out.save();
  },
};
window.OPS = OPS;
