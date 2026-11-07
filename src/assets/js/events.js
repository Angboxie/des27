// DES27 page motion: scroll reveals, scroll-linked drift, lines, tilt,
// magnetic buttons, the upcoming carousel and the archive stack.
// Everything here is decoration - the pages work without it.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));


/* Reveal on scroll - plays every time, from the side the element enters */

const revealTargets = document.querySelectorAll(".reveal, .ev-rule, [data-archive]");
const peekTargets = document.querySelectorAll(".ev-featured");

if ("IntersectionObserver" in window && !reduceMotion) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const el = entry.target;
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
        } else {
          // left through the top -> come back in from above next time
          el.dataset.from = entry.boundingClientRect.top < 0 ? "above" : "below";
          el.classList.remove("is-visible");
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );

  revealTargets.forEach((el) => observer.observe(el));

  // Blue bands open as soon as they peek in, so the bottom of the hero
  // shows the photo and hints that there is more below
  const peekObserver = new IntersectionObserver(
    (entries) => entries.forEach((entry) => entry.target.classList.toggle("is-visible", entry.isIntersecting)),
    { threshold: 0 }
  );
  peekTargets.forEach((el) => peekObserver.observe(el));
} else {
  peekTargets.forEach((el) => el.classList.add("is-visible"));
  revealTargets.forEach((el) => el.classList.add("is-visible"));
}


/* Scroll-linked motion */

if (!reduceMotion) {
  const vh = () => window.innerHeight;

  // Page position ignoring transforms, so drift doesn't feed back into itself
  const docTop = (el) => {
    let top = 0;
    for (let node = el; node; node = node.offsetParent) top += node.offsetTop;
    return top;
  };

  let items = [];

  const measure = () => {
    const find = (selector, read) =>
      Array.from(document.querySelectorAll(selector)).map((el) => {
        const box = el instanceof SVGElement ? el.parentElement : el;
        return { el, top: docTop(box), height: box.offsetHeight, ...read(el) };
      });

    items = [
      ...find("[data-lag]", (el) => ({ type: "lag", amount: parseFloat(el.dataset.lag) })),
      ...find("[data-speed]", (el) => ({ type: "speed", amount: parseFloat(el.dataset.speed) })),
      ...find("[data-x]", (el) => ({ type: "x", amount: parseFloat(el.dataset.x) })),
      ...find(".draw-line", () => ({ type: "draw" })),
      ...find("[data-archive-stack]", () => ({ type: "fan" })),
      ...find(".ev-featured__media", () => ({ type: "photo" })),
    ];
  };

  let lastY = window.scrollY;
  let velocity = 0;
  let running = false;
  const skewTargets = document.querySelectorAll("[data-skew]");

  const frame = () => {
    const y = window.scrollY;
    const h = vh();

    // smoothed scroll speed, used for the lean on card rows
    velocity += (y - lastY - velocity) * 0.18;
    lastY = y;

    items.forEach((item) => {
      // -1 (above centre) .. 0 (centred) .. 1 (below centre)
      const centre = (item.top + item.height / 2 - y - h / 2) / h;
      // 0 as it enters from the bottom, 1 once it's well into view
      const enter = clamp((h - (item.top - y)) / (h * 0.85), 0, 1);
      const style = item.el.style;

      switch (item.type) {
        case "lag":
          style.setProperty("--ty", `${(y * item.amount).toFixed(1)}px`);
          break;
        case "speed":
          style.setProperty("--ty", `${(-centre * item.amount * h).toFixed(1)}px`);
          break;
        case "x":
          style.setProperty("--tx", `${(centre * item.amount).toFixed(1)}px`);
          break;
        case "draw":
          style.setProperty("--draw", enter.toFixed(3));
          break;
        case "fan":
          style.setProperty("--fan", (0.35 + enter * 0.75).toFixed(3));
          break;
        case "photo":
          style.setProperty("--p", clamp(centre, -1, 1).toFixed(3));
          break;
      }
    });

    const lean = clamp(velocity * -0.06, -3.5, 3.5);
    skewTargets.forEach((el) => el.style.setProperty("--skew", `${lean.toFixed(2)}deg`));

    if (Math.abs(velocity) > 0.05) {
      requestAnimationFrame(frame);
    } else {
      running = false;
      velocity = 0;
      skewTargets.forEach((el) => el.style.setProperty("--skew", "0deg"));
    }
  };

  const start = () => {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  };

  const remeasure = () => {
    measure();
    running = false;
    frame();
  };

  measure();
  frame();
  window.addEventListener("scroll", start, { passive: true });
  window.addEventListener("resize", remeasure);
  window.addEventListener("load", remeasure);
  if (document.fonts) document.fonts.ready.then(remeasure);


  /* Pointer effects (mouse / trackpad only) */

  if (finePointer) {
    const blob = document.querySelector(".ev-hero__blob");
    if (blob) {
      window.addEventListener("pointermove", (event) => {
        blob.style.setProperty("--mx", ((event.clientX / window.innerWidth) * 2 - 1).toFixed(3));
        blob.style.setProperty("--my", ((event.clientY / window.innerHeight) * 2 - 1).toFixed(3));
      }, { passive: true });
    }

    // Buttons lean toward the pointer
    document.querySelectorAll("[data-magnetic]").forEach((el) => {
      el.addEventListener("pointermove", (event) => {
        const rect = el.getBoundingClientRect();
        const x = (event.clientX - rect.left - rect.width / 2) * 0.25;
        const y = (event.clientY - rect.top - rect.height / 2) * 0.35;
        el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
      });
      el.addEventListener("pointerleave", () => { el.style.translate = ""; });
    });

    // Cards and the front archive photo tilt toward the pointer
    const tilt = (host, target, strength) => {
      host.addEventListener("pointermove", (event) => {
        const el = target();
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;
        el.style.setProperty("--ry", `${(px * strength).toFixed(2)}deg`);
        el.style.setProperty("--rx", `${(-py * strength).toFixed(2)}deg`);
      });
      host.addEventListener("pointerleave", () => {
        const el = target();
        if (!el) return;
        el.style.removeProperty("--rx");
        el.style.removeProperty("--ry");
      });
    };

    document.querySelectorAll("[data-tilt]").forEach((card) => {
      tilt(card, () => card.querySelector(".ev-card__media"), 10);
    });

    document.querySelectorAll("[data-archive-stack]").forEach((stack) => {
      tilt(stack, () => stack.querySelector('[data-pos="0"] figure'), 8);
    });
  }
}


/* Upcoming events carousel */

document.querySelectorAll("[data-carousel]").forEach((carousel) => {
  const track = carousel.querySelector("[data-carousel-track]");
  const prev = carousel.querySelector("[data-carousel-prev]");
  const next = carousel.querySelector("[data-carousel-next]");
  const dotsWrap = carousel.querySelector("[data-carousel-dots]");
  const progress = carousel.querySelector("[data-carousel-progress]");
  if (!track) return;

  const cards = Array.from(track.children);

  const step = () => {
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return cards[0].getBoundingClientRect().width + gap;
  };

  const maxScroll = () => track.scrollWidth - track.clientWidth;

  const dots = !dotsWrap ? [] : cards.map((card, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "ev-carousel__dot";
    dot.setAttribute("aria-label", `Go to event ${index + 1}`);
    dot.addEventListener("click", () => goTo(index));
    dotsWrap.appendChild(dot);
    return dot;
  });

  function goTo(index) {
    track.scrollTo({ left: Math.min(index * step(), maxScroll()) });
  }

  function currentIndex() {
    if (track.scrollLeft >= maxScroll() - 2) return cards.length - 1;
    return Math.round(track.scrollLeft / step());
  }

  function updateControls() {
    const active = currentIndex();
    dots.forEach((dot, index) => dot.setAttribute("aria-current", String(index === active)));
    if (prev) prev.disabled = track.scrollLeft <= 2;
    if (next) next.disabled = track.scrollLeft >= maxScroll() - 2;
    if (progress) {
      progress.style.setProperty("--pos", (maxScroll() > 0 ? track.scrollLeft / maxScroll() : 0).toFixed(3));
    }
  }

  if (prev) prev.addEventListener("click", () => track.scrollBy({ left: -step() }));
  if (next) next.addEventListener("click", () => track.scrollBy({ left: step() }));

  let frame;
  track.addEventListener("scroll", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(updateControls);
  }, { passive: true });
  window.addEventListener("resize", updateControls);
  updateControls();

  // Click-and-drag with a mouse (touch already scrolls natively)
  let drag = null;

  track.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    drag = { x: event.clientX, left: track.scrollLeft, moved: false };
  });

  window.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 5) {
      drag.moved = true;
      track.classList.add("is-dragging");
    }
    if (drag.moved) track.scrollLeft = drag.left - dx;
  });

  window.addEventListener("pointerup", () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) return;

    // settle on the nearest card
    const target = Math.round(track.scrollLeft / step());
    track.classList.remove("is-dragging");
    goTo(target);

    // stop the drag from also clicking a link
    track.addEventListener("click", (e) => e.preventDefault(), { capture: true, once: true });
  });
});


/* Event archive: a shuffling stack of photos */

document.querySelectorAll("[data-archive]").forEach((stage) => {
  const items = Array.from(stage.querySelectorAll("[data-archive-item]"));
  const prev = stage.querySelector("[data-archive-prev]");
  const next = stage.querySelector("[data-archive-next]");
  let order = items.map((_, index) => index);
  let busy = false;

  function layout() {
    order.forEach((itemIndex, pos) => {
      const item = items[itemIndex];
      item.dataset.pos = pos <= 3 ? String(pos) : "hidden";
      item.setAttribute("aria-hidden", String(pos !== 0));
      item.querySelector(".ev-archive__link").tabIndex = pos === 0 ? 0 : -1;
      // clear any tilt left on a photo that's no longer in front
      if (pos !== 0) {
        const figure = item.querySelector("figure");
        figure.style.removeProperty("--rx");
        figure.style.removeProperty("--ry");
      }
    });
  }

  // Where an item ends up once its transition has finished
  function settledTransform(item) {
    item.style.transition = "none";
    const value = getComputedStyle(item).transform;
    item.offsetWidth; // apply before restoring the transition
    item.style.transition = "";
    return value;
  }

  function shuffle(direction) {
    if (busy || items.length < 2) return;
    busy = true;

    const mover = direction > 0 ? items[order[0]] : items[order[order.length - 1]];
    const from = getComputedStyle(mover).transform;

    if (direction > 0) order.push(order.shift());
    else order.unshift(order.pop());

    layout();
    const to = settledTransform(mover);
    const side = direction > 0 ? 1 : -1;
    const fling = `translate(${side * 62}%, -8%) rotate(${side * 12}deg) scale(0.96)`;

    const keyframes = direction > 0
      ? [
          { transform: from, zIndex: 5, opacity: 1 },
          { transform: fling, zIndex: 5, opacity: 1, offset: 0.45 },
          { transform: fling, zIndex: 0, opacity: 0.6, offset: 0.46 },
          { transform: to, zIndex: 0 },
        ]
      : [
          { transform: from, zIndex: 0, opacity: 0.4 },
          { transform: fling, zIndex: 0, opacity: 0.8, offset: 0.45 },
          { transform: fling, zIndex: 5, opacity: 1, offset: 0.46 },
          { transform: to, zIndex: 5, opacity: 1 },
        ];

    const animation = mover.animate(keyframes, {
      duration: reduceMotion ? 1 : 1000,
      easing: "cubic-bezier(0.65, 0, 0.35, 1)",
    });

    animation.onfinish = () => { busy = false; };
  }

  layout();
  next.addEventListener("click", () => { shuffle(1); restartAuto(); });
  prev.addEventListener("click", () => { shuffle(-1); restartAuto(); });

  stage.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") { shuffle(1); restartAuto(); }
    if (event.key === "ArrowLeft") { shuffle(-1); restartAuto(); }
  });

  // Shuffle by itself while on screen, pausing while someone is interacting
  let timer = null;
  let paused = false;

  function restartAuto() {
    clearInterval(timer);
    timer = null;
    if (reduceMotion || paused || !stage.classList.contains("is-visible")) return;
    timer = setInterval(() => {
      if (!document.hidden) shuffle(1);
    }, 4500);
  }

  stage.addEventListener("pointerenter", () => { paused = true; restartAuto(); });
  stage.addEventListener("pointerleave", () => { paused = false; restartAuto(); });
  stage.addEventListener("focusin", () => { paused = true; restartAuto(); });
  stage.addEventListener("focusout", () => { paused = false; restartAuto(); });

  // the reveal observer toggles .is-visible on the stage
  new MutationObserver(restartAuto).observe(stage, { attributes: true, attributeFilter: ["class"] });
});
