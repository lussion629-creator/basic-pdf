// fontkit 2 를 pdf-lib(@pdf-lib/fontkit 인터페이스)에 맞게 감싼다. 서브셋 품질이 더 정확함.
import * as fk from 'fontkit';
export function create(buf) {
  const f = fk.create(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const cs = f.createSubset.bind(f);
  f.createSubset = () => {
    const s = cs();
    s.encodeStream = () => {
      const h = {};
      const api = { on(ev, fn) { h[ev] = fn; if (h.data && h.end) setTimeout(() => { h.data(s.encode()); h.end(); }); return api; } };
      return api;
    };
    return s;
  };
  return f;
}
