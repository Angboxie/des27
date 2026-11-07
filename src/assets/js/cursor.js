// Custom cursor for DES27 pages: a dot that follows the pointer exactly and a
// ring that trails behind it. Mouse/trackpad only - touch devices keep the default.

(() => {
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!finePointer) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const cursor = document.createElement("div");
  cursor.className = "des-cursor";
  cursor.setAttribute("aria-hidden", "true");
  cursor.innerHTML = '<div class="des-cursor__ring"><span class="des-cursor__label"></span></div><div class="des-cursor__dot"></div>';
  document.body.appendChild(cursor);
  document.documentElement.classList.add("has-cursor");

  const ring = cursor.querySelector(".des-cursor__ring");
  const dot = cursor.querySelector(".des-cursor__dot");
  const label = cursor.querySelector(".des-cursor__label");

  const interactive = "a, button, [role='button'], label, summary, [data-cursor-label]";
  const target = { x: -100, y: -100 };
  const ringPos = { x: -100, y: -100 };
  let visible = false;

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    target.x = event.clientX;
    target.y = event.clientY;
    dot.style.translate = `${target.x}px ${target.y}px`;

    if (!visible) {
      visible = true;
      ringPos.x = target.x;
      ringPos.y = target.y;
      cursor.classList.add("is-visible");
    }

    const el = event.target instanceof Element ? event.target : null;
    const hoverEl = el && el.closest(interactive);
    const labelEl = el && el.closest("[data-cursor-label]");
    const lightEl = el && el.closest("[data-cursor='light']");
    const disabled = hoverEl && hoverEl.matches(":disabled");

    cursor.classList.toggle("is-hover", Boolean(hoverEl) && !disabled && !labelEl);
    cursor.classList.toggle("is-label", Boolean(labelEl));
    cursor.classList.toggle("is-light", Boolean(lightEl));
    label.textContent = labelEl ? labelEl.dataset.cursorLabel : "";
  }, { passive: true });

  document.addEventListener("pointerleave", () => {
    visible = false;
    cursor.classList.remove("is-visible");
  });

  window.addEventListener("pointerdown", () => cursor.classList.add("is-down"));
  window.addEventListener("pointerup", () => cursor.classList.remove("is-down"));

  const ease = reduceMotion ? 1 : 0.18;
  let running = false;

  // Only animates while the ring is catching up, then sleeps
  const tick = () => {
    ringPos.x += (target.x - ringPos.x) * ease;
    ringPos.y += (target.y - ringPos.y) * ease;
    ring.style.translate = `${ringPos.x.toFixed(2)}px ${ringPos.y.toFixed(2)}px`;

    if (Math.abs(target.x - ringPos.x) + Math.abs(target.y - ringPos.y) > 0.1) {
      requestAnimationFrame(tick);
    } else {
      running = false;
    }
  };

  window.addEventListener("pointermove", () => {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }, { passive: true });
})();
