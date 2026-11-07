// Learn pages: resource filters and the enlarged photo viewer

/* Resource library filters */

document.querySelectorAll("[data-filters]").forEach((form) => {
  const items = Array.from(document.querySelectorAll("[data-filter-list] > li"));
  const count = form.querySelector("[data-filter-count]");
  const empty = document.querySelector("[data-filter-empty]");

  const apply = () => {
    const data = new FormData(form);
    const query = String(data.get("q") || "").trim().toLowerCase();
    const type = data.get("type");
    const lists = ["software", "year", "discipline"].map((key) => [key, data.get(key)]);
    const recommendedOnly = data.get("recommended") === "on";
    let shown = 0;

    items.forEach((item) => {
      const match =
        (!query || item.dataset.search.includes(query)) &&
        (!type || item.dataset.type === type) &&
        lists.every(([key, value]) => !value || item.dataset[key].includes(`|${value}|`)) &&
        (!recommendedOnly || item.dataset.recommended);

      if (match && item.hidden) {
        item.hidden = false;
        item.classList.remove("is-shown");
        void item.offsetWidth; // restart the appear animation
        item.classList.add("is-shown");
      } else if (!match) {
        item.hidden = true;
      }
      if (match) shown += 1;
    });

    count.textContent = `${shown} resource${shown === 1 ? "" : "s"}`;
    empty.hidden = shown > 0;
  };

  form.addEventListener("input", apply);
  form.addEventListener("change", apply);
});


/* Enlarged photo viewer for galleries */

document.querySelectorAll("[data-lightbox]").forEach((gallery) => {
  const links = Array.from(gallery.querySelectorAll("[data-lightbox-item]"));
  if (!links.length || typeof HTMLDialogElement !== "function") return;

  const dialog = document.createElement("dialog");
  dialog.className = "ed-lightbox";
  dialog.setAttribute("aria-label", "Photo viewer");
  dialog.innerHTML = `
    <figure><img alt=""><figcaption></figcaption></figure>
    <button type="button" data-close aria-label="Close">&times;</button>
    <button type="button" data-prev aria-label="Previous photo">&larr;</button>
    <button type="button" data-next aria-label="Next photo">&rarr;</button>`;
  document.body.appendChild(dialog);

  const img = dialog.querySelector("img");
  const caption = dialog.querySelector("figcaption");
  let index = 0;

  const show = (i) => {
    index = (i + links.length) % links.length;
    const link = links[index];
    img.src = link.href;
    img.alt = link.querySelector("img")?.alt || "";
    caption.textContent = link.dataset.caption || "";
    // replay the zoom-in animation
    img.style.animation = "none";
    void img.offsetWidth;
    img.style.animation = "";
  };

  links.forEach((link, i) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      show(i);
      dialog.showModal();
    });
  });

  const multiple = links.length > 1;
  dialog.querySelector("[data-prev]").hidden = !multiple;
  dialog.querySelector("[data-next]").hidden = !multiple;
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-prev]").addEventListener("click", () => show(index - 1));
  dialog.querySelector("[data-next]").addEventListener("click", () => show(index + 1));

  // click the dark backdrop to close
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" && multiple) show(index - 1);
    if (event.key === "ArrowRight" && multiple) show(index + 1);
  });
});


/* Close the "Add to calendar" menu when clicking elsewhere */

document.addEventListener("click", (event) => {
  document.querySelectorAll(".ed-cal[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute("open");
  });
});
