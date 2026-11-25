// OPEN CITY page: the hero numbers count up the first time they come into view.
(function () {
  const numbers = document.querySelectorAll("[data-count]");
  if (!numbers.length || !("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const format = new Intl.NumberFormat("en-AU");

  function countUp(el) {
    // "$3,500" -> prefix "$", target 3500; anything that isn't a plain number is left alone
    const match = el.textContent.trim().match(/^(\D*)([\d,]+)(\D*)$/);
    if (!match) return;
    const [, prefix, digits, suffix] = match;
    const target = Number(digits.replace(/,/g, ""));
    const start = performance.now();
    const duration = 1400;

    // hold the final width so the row doesn't shift while the digits change
    el.style.display = "inline-block";
    el.style.minWidth = el.getBoundingClientRect().width + "px";

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = prefix + format.format(Math.round(target * eased)) + suffix;
      if (t < 1) requestAnimationFrame(frame);
      else el.style.minWidth = ""; // done: let the text set its own width again
    }
    requestAnimationFrame(frame);
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      countUp(entry.target);
    });
  }, { threshold: 0.6 });

  // measure widths in the real display font, not the wider fallback
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(() => numbers.forEach((el) => observer.observe(el)));
})();
