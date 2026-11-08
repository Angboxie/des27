// Menu toggle, sticky header and page-transition click point

const siteNav = document.getElementById("site-nav");
// The header "Menu" button (older pages) and the phone tab bar's "Menu" button
const menuToggles = Array.from(document.querySelectorAll(".nav-toggle, [data-menu-toggle]"));
const root = document.documentElement;

function setMenu(open, origin) {
  // The full-screen phone menu spreads out from the button that opened it
  if (open && origin) {
    const box = origin.getBoundingClientRect();
    root.style.setProperty("--menu-x", `${Math.round(box.left + box.width / 2)}px`);
    root.style.setProperty("--menu-y", `${Math.round(box.top + box.height / 2)}px`);
  }

  menuToggles.forEach((toggle) => {
    toggle.setAttribute("aria-expanded", String(open));
    const label = toggle.querySelector("[data-menu-label]");
    if (label) label.textContent = open ? "Close" : "Menu";
  });
  siteNav.classList.toggle("is-open", open);
  root.classList.toggle("menu-open", open);
}

if (menuToggles.length && siteNav) {
  menuToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      setMenu(!siteNav.classList.contains("is-open"), toggle);
    });
  });

  // Choosing a link closes the menu (the page transition takes over from there)
  siteNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenu(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && siteNav.classList.contains("is-open")) {
      setMenu(false);
      const visible = menuToggles.find((toggle) => toggle.offsetParent !== null);
      if (visible) visible.focus();
    }
  });

  // Coming back to a page from the back/forward cache: make sure the menu is shut
  window.addEventListener("pageshow", () => setMenu(false));
}


// Sticky header: frosted once the page has scrolled. On phones it also tucks
// away while you scroll down and comes back as soon as you scroll up.
const stickyHeader = document.querySelector(".des-header");

if (stickyHeader) {
  const phone = window.matchMedia("(max-width: 59.99em)");
  let lastY = window.scrollY;

  const onScroll = () => {
    const y = window.scrollY;
    stickyHeader.classList.toggle("is-scrolled", y > 8);

    if (phone.matches && !root.classList.contains("menu-open")) {
      const goingDown = y > lastY + 4;
      const goingUp = y < lastY - 4;
      if (goingDown && y > 140) stickyHeader.classList.add("is-tucked");
      if (goingUp || y < 140) stickyHeader.classList.remove("is-tucked");
    } else {
      stickyHeader.classList.remove("is-tucked");
    }

    if (Math.abs(y - lastY) > 4) lastY = y;
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

// Page transition: remember where a link was clicked, so the next page can
// spread out from that point (see "Page transitions" in des27.css)
document.addEventListener("click", (event) => {
  const link = event.target.closest && event.target.closest("a[href]");
  if (!link || link.origin !== window.location.origin) return;
  try {
    sessionStorage.setItem("des-vt", JSON.stringify({
      x: event.clientX / window.innerWidth,
      y: event.clientY / window.innerHeight,
    }));
  } catch (error) { /* private mode */ }
});
