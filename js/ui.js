// DOM layer: loader, split-letter reveals, custom cursor, progress rail, coin ledger.

export function initUI() {
  const $ = (s) => document.querySelector(s);

  // split headings into words -> letters for staggered reveals
  document.querySelectorAll('[data-split]').forEach((el) => {
    let i = 0;
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach((w, wi) => {
      const word = document.createElement('span');
      word.className = 'word';
      for (const ch of w) {
        const s = document.createElement('span');
        s.className = 'char';
        s.textContent = ch;
        s.style.setProperty('--i', i++);
        word.appendChild(s);
      }
      el.appendChild(word);
      if (wi < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.target.classList.toggle('in', e.isIntersecting));
  }, { threshold: 0.25 });
  document.querySelectorAll('.reveal, [data-split]').forEach((el) => io.observe(el));

  // cursor
  const ring = $('.cursor'), dot = $('.cursor-dot'), label = $('.cursor-label');
  const pos = { x: innerWidth / 2, y: innerHeight / 2 }, lag = { ...pos };
  addEventListener('pointermove', (e) => { pos.x = e.clientX; pos.y = e.clientY; });
  document.querySelectorAll('a, button').forEach((el) => {
    el.addEventListener('pointerenter', () => ring.classList.add('hover'));
    el.addEventListener('pointerleave', () => ring.classList.remove('hover'));
  });

  // loader counter
  const loader = $('.loader'), count = $('.loader-count');
  let shown = 0, goal = 86, done = false;
  const tick = () => {
    shown += (goal - shown) * 0.08;
    count.textContent = String(Math.floor(shown)).padStart(3, '0');
    if (!done || shown < 99.5) requestAnimationFrame(tick);
    else count.textContent = '100';
  };
  tick();

  const rail = $('.rail-fill'), dots = [...document.querySelectorAll('.rail-dot')];
  const ledger = $('.ledger-count'), ledgerValue = $('.ledger-value');
  const hint = $('.hint');
  // DOM writes only when something changed: each one can cost a style recalc
  const last = { rail: -1, active: -1, coins: -1, tree: null, hint: null };

  return {
    ready() {
      done = true;
      goal = 100;
      setTimeout(() => { loader.classList.add('gone'); document.body.classList.add('ready'); }, 700);
    },

    burst(x, y) {
      for (let i = 0; i < 14; i++) {
        const c = document.createElement('span');
        c.className = 'spark';
        const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 90;
        c.style.left = x + 'px';
        c.style.top = y + 'px';
        c.style.setProperty('--dx', Math.cos(a) * d + 'px');
        c.style.setProperty('--dy', Math.sin(a) * d + 'px');
        document.body.appendChild(c);
        setTimeout(() => c.remove(), 900);
      }
    },

    update({ p, weights, coins, totalCoins, charm }) {
      lag.x += (pos.x - lag.x) * 0.18;
      lag.y += (pos.y - lag.y) * 0.18;
      ring.style.transform = `translate3d(${lag.x}px, ${lag.y}px, 0)`;
      dot.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      const mode = weights.tree > 0.6 ? 'shake' : weights.sculpture > 0.5 ? 'drag' : 'charm';
      if (label.textContent !== mode) label.textContent = mode;

      const railP = Math.round(p * 1000) / 1000;
      if (railP !== last.rail) { last.rail = railP; rail.style.transform = `scaleY(${railP})`; }
      const active = p > 0.93 ? 3 : weights.sculpture > 0.5 ? 2 : weights.tree > 0.5 ? 1 : 0;
      if (active !== last.active) { last.active = active; dots.forEach((d, i) => d.classList.toggle('on', i === active)); }

      if (coins !== last.coins) {
        last.coins = coins;
        ledger.textContent = String(coins).padStart(4, '0');
        ledgerValue.textContent = (coins * 1288).toLocaleString('en-US');
      }
      const inTree = weights.tree > 0.5, showHint = charm < 0.2 && weights.hero > 0.5;
      if (inTree !== last.tree) { last.tree = inTree; document.body.classList.toggle('in-tree', inTree); }
      if (showHint !== last.hint) { last.hint = showHint; hint.classList.toggle('show', showHint); }
    },
  };
}
