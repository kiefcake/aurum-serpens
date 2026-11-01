// Wheel smoothing for mouse and trackpad: notched wheels jump 100px at a time,
// which makes the copy stutter even when the 3D camera is eased. Wheel input
// moves a target and the page glides toward it each frame. Touch, keyboard and
// the scrollbar stay native; in-page anchor links glide too.

export function initSmoothScroll() {
  const fine = matchMedia('(pointer: fine)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let target = scrollY, current = scrollY, active = false, rate = 10, lastFrame = 0;
  const max = () => document.documentElement.scrollHeight - innerHeight;
  const clamp = (v) => Math.min(Math.max(v, 0), max());

  const glide = (to, speed) => {
    if (!active) current = scrollY;
    target = clamp(to);
    rate = speed;
    active = true;
  };

  if (fine && !reduced) {
    addEventListener('wheel', (e) => {
      // no frames arriving (throttled tab, stalled loop): leave the wheel native
      if (e.ctrlKey || !document.body.classList.contains('ready') || performance.now() - lastFrame > 250) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1;
      glide((active ? target : scrollY) + e.deltaY * unit, 10);
    }, { passive: false });
  }

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const el = document.querySelector(a.getAttribute('href'));
      if (!el) return;
      e.preventDefault();
      if (reduced) scrollTo(0, el.offsetTop);
      else glide(el.offsetTop, 3.2);
    });
  });

  // anything else that scrolls the page (keys, scrollbar, touch) takes over
  const cancel = () => { active = false; };
  addEventListener('keydown', cancel);
  addEventListener('pointerdown', (e) => { if (e.clientX >= document.documentElement.clientWidth) cancel(); });
  addEventListener('touchstart', cancel, { passive: true });

  return {
    update(dt) {
      lastFrame = performance.now();
      if (!active) return;
      current += (target - current) * (1 - Math.exp(-dt * rate));
      if (Math.abs(target - current) < 0.5) { current = target; active = false; }
      scrollTo({ top: current, behavior: 'instant' });
    },
  };
}
