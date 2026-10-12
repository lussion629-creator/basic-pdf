'use strict';
/* 주석 객체 모델과 SVG 렌더링.
   좌표계: 페이지 "왼쪽 위 기준" 포인트 단위(회전 전). x→오른쪽, y→아래. */
const SVGNS = 'http://www.w3.org/2000/svg';

const ANN = {
  TYPES: {
    highlight: { label: '강조', icon: 'highlighter' },
    underline: { label: '밑줄', icon: 'underline' },
    strike: { label: '취소선', icon: 'strikethrough' },
    ink: { label: '그리기', icon: 'pen-tool' },
    rect: { label: '사각형', icon: 'square' },
    ellipse: { label: '타원', icon: 'circle' },
    line: { label: '선', icon: 'minus' },
    arrow: { label: '화살표', icon: 'move-up-right' },
    text: { label: '텍스트 상자', icon: 'type' },
    edittext: { label: '텍스트 편집', icon: 'file-pen-line' },
    note: { label: '메모', icon: 'sticky-note' },
    stamp: { label: '스탬프', icon: 'stamp' },
    image: { label: '이미지', icon: 'image' },
    signature: { label: '서명', icon: 'signature' },
    whiteout: { label: '화이트아웃', icon: 'eraser' },
  },
  STAMPS: [
    { label: '승인됨', color: '#2f8f5b' },
    { label: '검토됨', color: '#1f6fd6' },
    { label: '완료', color: '#2f8f5b' },
    { label: '반려', color: '#d4382c' },
    { label: '기밀', color: '#d4382c' },
    { label: '초안', color: '#7353d9' },
    { label: '확인 필요', color: '#dc6a1c' },
    { label: 'APPROVED', color: '#2f8f5b' },
  ],
  COLORS: ['#ffd400', '#ffa31a', '#ff6b6b', '#e0332f', '#d63aa8', '#7b5cff', '#2f6fde', '#16a3b8', '#2fb36b', '#1a1a1a', '#ffffff'],

  uid() { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },

  isBox(o) { return ['rect', 'ellipse', 'text', 'edittext', 'stamp', 'image', 'signature', 'whiteout'].includes(o.type); },

  bbox(o) {
    switch (o.type) {
      case 'highlight': case 'underline': case 'strike': {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const [x, y, w, h] of o.rects) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x + w); y2 = Math.max(y2, y + h); }
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      case 'ink': {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (let i = 0; i < o.pts.length; i += 2) { const x = o.pts[i], y = o.pts[i + 1]; x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
        const p = o.width / 2;
        return { x: x1 - p, y: y1 - p, w: x2 - x1 + 2 * p, h: y2 - y1 + 2 * p };
      }
      case 'line': case 'arrow':
        return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
      case 'note':
        return { x: o.x, y: o.y, w: 20, h: 20 };
      default:
        return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
  },

  move(o, dx, dy) {
    switch (o.type) {
      case 'highlight': case 'underline': case 'strike':
        o.rects = o.rects.map(([x, y, w, h]) => [x + dx, y + dy, w, h]); break;
      case 'ink':
        for (let i = 0; i < o.pts.length; i += 2) { o.pts[i] += dx; o.pts[i + 1] += dy; } break;
      case 'line': case 'arrow':
        o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; break;
      default:
        o.x += dx; o.y += dy;
    }
  },

  // 상자 기준 크기 조정 (from: 이전 bbox, to: 새 bbox)
  scaleTo(o, from, to) {
    const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
    const mx = (x) => to.x + (x - from.x) * sx, my = (y) => to.y + (y - from.y) * sy;
    if (o.type === 'ink') {
      for (let i = 0; i < o.pts.length; i += 2) { o.pts[i] = mx(o.pts[i]); o.pts[i + 1] = my(o.pts[i + 1]); }
    } else if (this.isBox(o)) {
      o.x = to.x; o.y = to.y; o.w = Math.max(4, to.w); o.h = Math.max(4, to.h);
    }
  },

  inkPath(pts) {
    if (pts.length < 2) return '';
    if (pts.length <= 4) {
      const [x, y] = pts; const x2 = pts[2] ?? x + 0.01, y2 = pts[3] ?? y + 0.01;
      return `M${f(x)} ${f(y)}L${f(x2)} ${f(y2)}`;
    }
    let d = `M${f(pts[0])} ${f(pts[1])}`;
    for (let i = 2; i < pts.length - 2; i += 2) {
      const xc = (pts[i] + pts[i + 2]) / 2, yc = (pts[i + 1] + pts[i + 3]) / 2;
      d += `Q${f(pts[i])} ${f(pts[i + 1])} ${f(xc)} ${f(yc)}`;
    }
    const n = pts.length;
    d += `L${f(pts[n - 2])} ${f(pts[n - 1])}`;
    return d;
  },

  arrowHead(o) {
    const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
    const len = Math.max(8, o.width * 4.5), spread = Math.PI / 7;
    const ax = o.x2 - len * Math.cos(ang - spread), ay = o.y2 - len * Math.sin(ang - spread);
    const bx = o.x2 - len * Math.cos(ang + spread), by = o.y2 - len * Math.sin(ang + spread);
    return `M${f(ax)} ${f(ay)}L${f(o.x2)} ${f(o.y2)}L${f(bx)} ${f(by)}`;
  },

  ellipsePath(x, y, w, h) {
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
    return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
  },

  roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`;
  },

  stampSub(o) { return [o.author, o.dateText].filter(Boolean).join(' · '); },

  // SVG 요소 생성 (scale: 현재 화면 배율, 히트 영역 두께 계산용)
  render(o, scale) {
    const g = el('g', { class: 'pl-obj', 'data-id': o.id });
    const op = o.opacity ?? 1;
    switch (o.type) {
      case 'highlight':
        // 보이는 색은 곱하기 레이어(renderHL)에서 그린다. 여기엔 선택용 영역만.
        for (const [x, y, w, h] of o.rects) g.append(el('rect', { x, y, width: w, height: h, fill: 'transparent', class: 'pl-hit' }));
        break;
      case 'underline': case 'strike': {
        for (const [x, y, w, h] of o.rects) {
          const th = Math.max(0.8, h * 0.075);
          const yy = o.type === 'underline' ? y + h - th / 2 : y + h * 0.55;
          g.append(el('rect', { x, y, width: w, height: h, fill: 'transparent', class: 'pl-hit' }));
          g.append(el('line', { x1: x, y1: yy, x2: x + w, y2: yy, stroke: o.color, 'stroke-width': th, 'stroke-opacity': op }));
        }
        break;
      }
      case 'ink': {
        const d = this.inkPath(o.pts);
        g.append(el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(o.width, 10 / scale), class: 'pl-hit', 'stroke-linecap': 'round' }));
        g.append(el('path', { d, fill: 'none', stroke: o.color, 'stroke-width': o.width, 'stroke-opacity': op, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        break;
      }
      case 'rect': case 'whiteout': {
        const isW = o.type === 'whiteout';
        g.append(el('rect', {
          x: o.x, y: o.y, width: o.w, height: o.h,
          fill: isW ? '#ffffff' : (o.fill || 'none'), 'fill-opacity': isW ? 1 : op,
          stroke: isW ? 'none' : o.color, 'stroke-width': isW ? 0 : o.width, 'stroke-opacity': op,
        }));
        if (isW && scale) g.append(el('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: 'none', stroke: '#9aa0aa', 'stroke-width': 1 / scale, 'stroke-dasharray': `${3 / scale} ${3 / scale}`, class: 'pl-guide' }));
        break;
      }
      case 'ellipse':
        g.append(el('ellipse', { cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: o.w / 2, ry: o.h / 2, fill: o.fill || 'none', 'fill-opacity': op, stroke: o.color, 'stroke-width': o.width, 'stroke-opacity': op }));
        break;
      case 'line': case 'arrow': {
        const d = `M${o.x1} ${o.y1}L${o.x2} ${o.y2}` + (o.type === 'arrow' ? this.arrowHead(o) : '');
        g.append(el('path', { d, stroke: 'transparent', 'stroke-width': Math.max(o.width, 10 / scale), fill: 'none', class: 'pl-hit' }));
        g.append(el('path', { d, stroke: o.color, 'stroke-width': o.width, 'stroke-opacity': op, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        break;
      }
      case 'text': case 'edittext': {
        if (o.type === 'edittext' && o.cover) g.append(el('rect', { x: o.cover.x, y: o.cover.y, width: o.cover.w, height: o.cover.h, fill: '#ffffff', class: 'pl-cover' }));
        if (o.type === 'text' && o.bg) g.append(el('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: o.bg }));
        if (o.type === 'text' && o.border) g.append(el('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: 'none', stroke: o.color, 'stroke-width': 1 }));
        const fo = el('foreignObject', { x: o.x, y: o.y, width: Math.max(o.w, 1), height: Math.max(o.h, 1), style: 'overflow: visible' });
        const div = document.createElement('div');
        div.className = 'pl-fo-text';
        div.style.cssText = `font-size:${o.fontSize}px;color:${o.color};padding:${o.type === 'text' ? 2 : 0}px;` + (o.type === 'edittext' ? 'white-space:pre;' : '') + (o.bold ? 'font-weight:700;' : '');
        div.textContent = o.text;
        fo.append(div);
        g.append(fo);
        g.classList.add(o.type === 'edittext' ? 'edt' : 'txt');
        break;
      }
      case 'note': {
        const x = o.x, y = o.y;
        g.append(el('path', { d: `M${x + 1} ${y + 1}h18v13l-5 5h-13z`, fill: o.color || '#ffd400', stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.8 }));
        g.append(el('path', { d: `M${x + 19} ${y + 14}h-5v5`, fill: 'rgba(0,0,0,.15)', stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.8 }));
        g.append(el('path', { d: `M${x + 4.5} ${y + 6}h11M${x + 4.5} ${y + 9.5}h11M${x + 4.5} ${y + 13}h7`, stroke: 'rgba(0,0,0,.55)', 'stroke-width': 1 }));
        break;
      }
      case 'stamp': {
        const sub = this.stampSub(o);
        g.append(el('path', { d: this.roundRectPath(o.x, o.y, o.w, o.h, Math.min(8, o.h * 0.18)), fill: 'none', stroke: o.color, 'stroke-width': Math.max(1.5, o.h * 0.055), 'stroke-opacity': op }));
        const t1 = el('text', { x: o.x + o.w / 2, y: o.y + (sub ? o.h * 0.52 : o.h * 0.64), 'text-anchor': 'middle', fill: o.color, 'fill-opacity': op, 'font-size': o.h * (sub ? 0.4 : 0.46), 'font-weight': 800, 'font-family': '"Malgun Gothic", "Segoe UI", sans-serif', 'letter-spacing': o.h * 0.02 });
        t1.textContent = o.label;
        g.append(t1);
        if (sub) {
          const t2 = el('text', { x: o.x + o.w / 2, y: o.y + o.h * 0.82, 'text-anchor': 'middle', fill: o.color, 'fill-opacity': op, 'font-size': o.h * 0.18, 'font-family': '"Malgun Gothic", "Segoe UI", sans-serif' });
          t2.textContent = sub;
          g.append(t2);
        }
        break;
      }
      case 'image': case 'signature':
        g.append(el('image', { x: o.x, y: o.y, width: o.w, height: o.h, href: o.src, preserveAspectRatio: 'none', opacity: op }));
        g.append(el('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: 'transparent', class: 'pl-hit' }));
        break;
    }
    return g;
  },

  renderHL(o) {
    const g = el('g', { 'data-id': o.id });
    for (const [x, y, w, h] of o.rects) g.append(el('rect', { x, y, width: w, height: h, fill: o.color, 'fill-opacity': o.opacity ?? 1 }));
    return g;
  },

  describe(o) {
    if (o.type === 'note') return o.text || '(빈 메모)';
    if (o.type === 'text' || o.type === 'edittext') return o.text || '';
    if (o.type === 'stamp') return o.label;
    if (['highlight', 'underline', 'strike'].includes(o.type)) return o.text ? `“${o.text}”` : '';
    return '';
  },
};

function f(n) { return Math.round(n * 100) / 100; }
function el(tag, attrs = {}) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  return e;
}
window.ANN = ANN;
window.svgEl = el;
