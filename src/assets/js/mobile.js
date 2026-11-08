// Touch-screen motion for DES pages - the phone counterpart to cursor.js:
// a bloom where you tap, cards that tilt under your finger, the hero title
// drifting apart as you scroll away, the tab bar's reading progress, and the
// blue glow following how the phone is tilted. Decoration only.

(() => {
  const touch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!touch || reduceMotion) return;

  const root = document.documentElement;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  root.classList.add("is-touch");


  /* Tap bloom: a ring spreads out from where you tap.
     Uses "click" so it only fires for taps, never when a swipe starts. */

  const interactive = "a, button, [role='button'], label, summary, select, input";

  document.addEventListener("click", (event) => {
    if (!event.clientX && !event.clientY) return; // keyboard "clicks"
    const target = event.target instanceof Element ? event.target : null;

    const bloom = document.createElement("span");
    bloom.className = "tap-bloom";
    if (target && target.closest(interactive)) bloom.classList.add("tap-bloom--hit");
    if (target && target.closest("[data-cursor='light']")) bloom.classList.add("tap-bloom--light");
    bloom.style.left = `${event.clientX}px`;
    bloom.style.top = `${event.clientY}px`;
    bloom.setAttribute("aria-hidden", "true");
    document.body.appendChild(bloom);
    bloom.addEventListener("animationend", () => bloom.remove());
  }, { capture: true, passive: true });


  /* Press tilt: cards lean toward your finger while pressed, then spring back.
     A swipe cancels the press, so scrolling never gets stuck mid-tilt. */

  const pressTargets = [
    ...Array.from(document.querySelectorAll("[data-tilt]")).map((card) => ({ host: card, target: () => card.querySelector(".ev-card__media") })),
    ...Array.from(document.querySelectorAll("[data-archive-stack]")).map((stack) => ({ host: stack, target: () => stack.querySelector('[data-pos="0"] figure') })),
  ];

  pressTargets.forEach(({ host, target }) => {
    let el = null;

    const lean = (event) => {
      const rect = el.getBoundingClientRect();
      const px = clamp((event.clientX - rect.left) / rect.width - 0.5, -0.5, 0.5);
      const py = clamp((event.clientY - rect.top) / rect.height - 0.5, -0.5, 0.5);
      el.style.setProperty("--ry", `${(px * 14).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${(-py * 14).toFixed(2)}deg`);
    };

    const release = () => {
      if (!el) return;
      const done = el;
      el = null;
      done.classList.remove("is-pressed");
      done.classList.add("is-springing");
      done.style.removeProperty("--rx");
      done.style.removeProperty("--ry");
      setTimeout(() => done.classList.remove("is-springing"), 700);
    };

    host.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      el = target();
      if (!el) return;
      el.classList.remove("is-springing");
      el.classList.add("is-pressed");
      lean(event);
    });

    host.addEventListener("pointermove", (event) => { if (el) lean(event); });
    host.addEventListener("pointerup", release);
    host.addEventListener("pointercancel", release);
    host.addEventListener("pointerleave", release);
  });


  /* Scroll-linked: the hero title drifts apart as it leaves the screen, and
     the tab bar fills a thin line as you read down the page. */

  const hero = document.querySelector(".ev-hero");
  const dockProgress = document.querySelector(".des-dock__progress");
  let queued = false;

  const onScroll = () => {
    queued = false;
    const y = window.scrollY;

    if (hero) {
      const out = clamp(y / (hero.offsetHeight * 0.8), 0, 1);
      hero.style.setProperty("--hero-out", out.toFixed(3));
    }

    if (dockProgress) {
      const max = root.scrollHeight - window.innerHeight;
      dockProgress.style.setProperty("--progress", (max > 0 ? clamp(y / max, 0, 1) : 0).toFixed(4));
    }
  };

  const requestScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(onScroll);
  };

  window.addEventListener("scroll", requestScroll, { passive: true });
  window.addEventListener("resize", requestScroll);
  onScroll();


  /* Tilt the phone and the blue glow in the hero drifts with it.
     iPhones only allow this after a permission popup, so there it's skipped. */

  const blob = document.querySelector(".ev-hero__blob");
  const needsPermission = typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";

  if (blob && "DeviceOrientationEvent" in window && !needsPermission) {
    let restBeta = null;
    let frame = 0;

    window.addEventListener("deviceorientation", (event) => {
      if (event.beta == null || event.gamma == null) return;
      if (restBeta === null) restBeta = event.beta; // however the phone is being held counts as level
      const x = clamp(event.gamma / 30, -1, 1);
      const y = clamp((event.beta - restBeta) / 30, -1, 1);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        blob.style.setProperty("--mx", x.toFixed(3));
        blob.style.setProperty("--my", y.toFixed(3));
      });
    });
  }
})();


// A short buzz (Android only - iPhones ignore it). Used by events.js for
// carousel stops and the photo-pile flick.
window.desHaptic = (ms = 8) => {
  const touch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!touch || reduceMotion || !navigator.vibrate) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate(ms); } catch (error) { /* not allowed */ }
};
