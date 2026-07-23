/**
 * <real-coin> — RealGram's signature tap coin as a framework-agnostic Web Component.
 *
 * The brand centrepiece: GOLD when connected/owned, SILVER when disconnected/locked.
 *   - tap        -> forges Zar (emits 'forge' with {gain})
 *   - hold 3s    -> toggles VPN connection (emits 'toggle-connection')
 *
 * Usage:
 *   <script type="module" src="/tokens/real-coin.js"></script>
 *   <real-coin connected size="150"></real-coin>
 *   el.addEventListener('forge', e => addZar(e.detail.gain));
 *   el.addEventListener('toggle-connection', () => toggleVpn());
 *
 * Attributes: connected (bool), size (px), combo (float, default 1)
 * Respects prefers-reduced-motion.
 */
const HOLD_MS = 3000;

class RealCoin extends HTMLElement {
  static get observedAttributes() { return ['connected', 'size', 'combo']; }

  constructor() {
    super();
    this._combo = 1;
    this._hold = null;
    this._holdStart = 0;
    this.attachShadow({ mode: 'open' });
  }

  get connected() { return this.hasAttribute('connected'); }
  set connected(v) { v ? this.setAttribute('connected', '') : this.removeAttribute('connected'); }
  get size() { return parseInt(this.getAttribute('size') || '150', 10); }
  get combo() { return parseFloat(this.getAttribute('combo') || '1'); }

  connectedCallback() { this._render(); }
  attributeChangedCallback() { if (this.shadowRoot.firstChild) this._paint(); }

  _render() {
    const s = this.size;
    const r = s / 2 - 9;
    const circ = 2 * Math.PI * r;
    this.shadowRoot.innerHTML = `
      <style>
        :host{ display:inline-block; }
        .stage{ position:relative; width:${s}px; height:${s}px; }
        .glow{ position:absolute; inset:-20%; border-radius:50%; filter:blur(10px); pointer-events:none; transition:background .4s,opacity .4s; }
        .ring{ position:absolute; inset:0; transform:rotate(-90deg); pointer-events:none; }
        .ring circle{ fill:none; stroke:#FF5A5A; stroke-width:4; stroke-linecap:round;
          stroke-dasharray:${circ}; stroke-dashoffset:${circ}; }
        .coin{ position:absolute; inset:0; border-radius:50%; display:flex; align-items:center; justify-content:center;
          cursor:pointer; user-select:none; border:3px solid #FFB627;
          box-shadow:0 0 0 6px rgba(255,182,39,.12), inset 0 2px 10px rgba(255,255,255,.12);
          transition:transform .08s, border-color .4s, box-shadow .4s; -webkit-tap-highlight-color:transparent; }
        .coin:active{ transform:scale(.95); }
        .glyph{ font-family:'Vazirmatn','Noto Sans Arabic',sans-serif; font-size:${Math.round(s*0.35)}px; font-weight:700; transition:color .4s; }
        .inner{ position:absolute; inset:12%; border-radius:50%;
          background:radial-gradient(circle, rgba(255,182,39,.5), transparent 70%); filter:blur(3px);
          animation:breathe 3.2s ease-in-out infinite; pointer-events:none; }
        @media (prefers-reduced-motion: reduce){ .inner{ animation:none; } }
        @keyframes breathe{ 0%,100%{transform:scale(1);opacity:.7} 50%{transform:scale(1.08);opacity:1} }
      </style>
      <div class="stage">
        <div class="glow" part="glow"></div>
        <div class="inner"></div>
        <svg class="ring" viewBox="0 0 ${s} ${s}"><circle cx="${s/2}" cy="${s/2}" r="${r}"></circle></svg>
        <div class="coin" part="coin"><span class="glyph">&#xFDFC;</span></div>
      </div>`;
    this._coin = this.shadowRoot.querySelector('.coin');
    this._glyph = this.shadowRoot.querySelector('.glyph');
    this._glow = this.shadowRoot.querySelector('.glow');
    this._ringC = this.shadowRoot.querySelector('.ring circle');
    this._circ = circ;
    this._bind();
    this._paint();
  }

  _paint() {
    const on = this.connected;
    this._coin.style.borderColor = on ? '#FFB627' : '#B7C0CC';
    this._coin.style.boxShadow = on
      ? '0 0 0 6px rgba(255,182,39,.12), inset 0 2px 10px rgba(255,255,255,.12)'
      : '0 0 0 6px rgba(183,192,204,.10), inset 0 2px 10px rgba(255,255,255,.08)';
    this._coin.style.background = on
      ? 'radial-gradient(circle at 35% 30%, #FFF3C4, #FFB627 55%, #8A5A00 100%)'
      : 'radial-gradient(circle at 35% 30%, #E8ECF1, #B7C0CC 55%, #4B525D 100%)';
    this._glyph.style.color = on ? '#241605' : '#20242b';
    this._glow.style.background = on
      ? 'radial-gradient(circle, rgba(255,182,39,.4), transparent 70%)'
      : 'radial-gradient(circle, rgba(183,192,204,.25), transparent 70%)';
    this._glow.style.opacity = on ? '.8' : '.4';
  }

  _bind() {
    const start = () => {
      this._holdStart = Date.now();
      this._hold = setInterval(() => {
        const pct = Math.min(1, (Date.now() - this._holdStart) / HOLD_MS);
        this._ringC.style.strokeDashoffset = this._circ * (1 - pct);
        if (pct >= 1) { this._clear(); this.dispatchEvent(new CustomEvent('toggle-connection', { bubbles: true })); }
      }, 16);
    };
    this._coin.addEventListener('pointerdown', start);
    this._coin.addEventListener('pointerup', () => {
      const held = this._holdStart ? Date.now() - this._holdStart : 0;
      this._clear();
      if (held < HOLD_MS - 30) {
        const gain = Math.round(6 * this.combo);
        this.dispatchEvent(new CustomEvent('forge', { bubbles: true, detail: { gain } }));
      }
    });
    this._coin.addEventListener('pointerleave', () => this._clear());
  }

  _clear() {
    clearInterval(this._hold); this._hold = null;
    this._ringC.style.transition = 'stroke-dashoffset .25s ease';
    this._ringC.style.strokeDashoffset = this._circ;
    setTimeout(() => { this._ringC.style.transition = ''; }, 260);
  }
}
customElements.define('real-coin', RealCoin);
export default RealCoin;
