// Mobile menu toggle

const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.getElementById("site-nav");

function setMenu(open) {
  navToggle.setAttribute("aria-expanded", String(open));
  siteNav.classList.toggle("is-open", open);
}

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = navToggle.getAttribute("aria-expanded") === "true";
    setMenu(!isOpen);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && siteNav.classList.contains("is-open")) {
      setMenu(false);
      navToggle.focus();
    }
  });
}


// Sticky header: add a shadow once the page has scrolled
const stickyHeader = document.querySelector(".des-header");

if (stickyHeader) {
  const onScroll = () => stickyHeader.classList.toggle("is-scrolled", window.scrollY > 8);
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
