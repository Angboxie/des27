// Locker hire card: size buttons, quantity stepper and the running total.
// The page still works without this - sizes are radio buttons and the
// quantity is a number field.

(() => {
  const form = document.querySelector("[data-locker-form]");
  if (!form) return;

  const total = form.querySelector("[data-locker-total]");
  const qty = form.querySelector("[data-locker-qty]");
  const note = form.querySelector("[data-locker-note]");
  const sizes = Array.from(form.querySelectorAll('input[name="size"]'));
  const min = Number(qty.min) || 1;
  const max = Number(qty.max) || 99;

  const quantity = () => Math.min(max, Math.max(min, parseInt(qty.value, 10) || min));

  function update() {
    const chosen = sizes.find((size) => size.checked) || sizes[0];
    const count = quantity();
    total.textContent = "$" + (Number(chosen.dataset.price) * count).toFixed(2);
    form.querySelectorAll("[data-qty-step]").forEach((button) => {
      const next = count + Number(button.dataset.qtyStep);
      button.disabled = next < min || next > max;
    });
  }

  sizes.forEach((size) => size.addEventListener("change", update));

  qty.addEventListener("input", update);
  qty.addEventListener("change", () => {
    qty.value = quantity();
    update();
  });

  form.querySelectorAll("[data-qty-step]").forEach((button) => {
    button.addEventListener("click", () => {
      qty.value = Math.min(max, Math.max(min, quantity() + Number(button.dataset.qtyStep)));
      update();
    });
  });

  // The price boxes further up the page pick that size in the card
  document.querySelectorAll("[data-pick-size]").forEach((link) => {
    link.addEventListener("click", () => {
      const size = sizes.find((input) => input.value === link.dataset.pickSize);
      if (!size) return;
      size.checked = true;
      update();
    });
  });

  // No booking link yet (hireUrl in _data/lockers.json): say so instead of leaving the page
  form.addEventListener("submit", (event) => {
    qty.value = quantity();
    if (form.getAttribute("action")) return;
    event.preventDefault();
    note.hidden = false;
  });

  update();
})();
