// OPEN CITY brief: hidden until the release time set in _data/opencity.json
// (briefs.unlocksAt), then shown without the page needing to be rebuilt.
// Once released, the brief is read in a frame on the page, one tab per PDF.
(function () {
  const root = document.querySelector("[data-briefs-unlock]");
  if (!root) return;

  const unlocksAt = Date.parse(root.dataset.briefsUnlock);
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  // a local preview shows the released state; add ?briefs=locked to the address to see the page before release
  const forced = local && new URLSearchParams(location.search).get("briefs") !== "locked";

  const frame = document.querySelector("[data-brief-frame]");
  const newTab = document.querySelector("[data-brief-newtab]");
  const tabs = Array.from(document.querySelectorAll(".ol-reader__tabs [data-brief-tab]"));
  // phones can't show a PDF inside a page, so there the tabs simply open the file
  const roomToRead = window.matchMedia("(min-width: 48em)");

  function show(url) {
    if (!frame) return;
    frame.src = url + "#view=FitH";
    if (newTab) newTab.href = url;
    tabs.forEach((tab) => {
      if (tab.href === url) tab.setAttribute("aria-current", "true");
      else tab.removeAttribute("aria-current");
    });
  }

  function unlock() {
    document.querySelectorAll("[data-brief-locked]").forEach((el) => { el.hidden = true; });
    document.querySelectorAll("[data-brief-open]").forEach((el) => { el.hidden = false; });
    if (roomToRead.matches && tabs[0]) show(tabs[0].href);
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-brief-tab]");
    if (!link || !frame || !roomToRead.matches) return;   // otherwise the link opens the PDF as normal
    event.preventDefault();
    show(link.href);
    if (link.hasAttribute("data-brief-jump")) {
      document.getElementById("brief-reader").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  const wait = unlocksAt - Date.now();
  if (forced || !(wait > 0)) return unlock();
  // someone with the page open at release time sees the brief appear
  if (wait < 2 ** 31) setTimeout(unlock, wait);
})();
