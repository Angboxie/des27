// Events page: scroll reveals, parallax, upcoming carousel and archive stack

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;


/* Reveal on scroll */

const revealTargets = document.querySelectorAll(
  ".reveal, .draw-line, .ev-featured, .ev-rule, [data-archive]"
);

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -5% 0px" }
  );

  revealTargets.forEach((el) => observer.observe(el));
} else {
  revealTargets.forEach((el) => el.classList.add("is-visible"));
}


/* Parallax: hero blob follows the pointer, featured photo drifts on scroll */

if (!reduceMotion) {
  const blob = document.querySelector(".ev-hero__blob");
  const featuredMedia = document.querySelector(".ev-featured__media");
  let pointer = null;
  let ticking = false;

  const update = () => {
    ticking = false;

    if (blob && pointer) {
      blob.style.setProperty("--mx", ((pointer.x / window.innerWidth) * 2 - 1).toFixed(3));
      blob.style.setProperty("--my", ((pointer.y / window.innerHeight) * 2 - 1).toFixed(3));
    }

    if (featuredMedia) {
      const rect = featuredMedia.getBoundingClientRect();
      const progress = (rect.top + rect.height / 2 - window.innerHeight / 2) / window.innerHeight;
      featuredMedia.style.setProperty("--p", Math.max(-1, Math.min(1, progress)).toFixed(3));
    }
  };

  const requestUpdate = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  window.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    requestUpdate();
  }, { passive: true });

  window.addEventListener("scroll", requestUpdate, { passive: true });
  requestUpdate();
}


/* Upcoming events carousel */

document.querySelectorAll("[data-carousel]").forEach((carousel) => {
  const track = carousel.querySelector("[data-carousel-track]");
  const prev = carousel.querySelector("[data-carousel-prev]");
  const next = carousel.querySelector("[data-carousel-next]");
  const dotsWrap = carousel.querySelector("[data-carousel-dots]");
  if (!track) return;

  const cards = Array.from(track.children);

  const step = () => {
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return cards[0].getBoundingClientRect().width + gap;
  };

  const maxScroll = () => track.scrollWidth - track.clientWidth;

  const dots = cards.map((card, index) => {
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
    prev.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft >= maxScroll() - 2;
  }

  prev.addEventListener("click", () => track.scrollBy({ left: -step() }));
  next.addEventListener("click", () => track.scrollBy({ left: step() }));

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
      item.style.setProperty("--order", pos);
      item.setAttribute("aria-hidden", String(pos !== 0));
      item.querySelector(".ev-archive__link").tabIndex = pos === 0 ? 0 : -1;
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
  next.addEventListener("click", () => shuffle(1));
  prev.addEventListener("click", () => shuffle(-1));

  stage.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") shuffle(1);
    if (event.key === "ArrowLeft") shuffle(-1);
  });
});
