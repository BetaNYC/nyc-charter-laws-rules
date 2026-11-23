/* The top bar's Menu button (burger), below 782px wide.
   The same behavior as BetaNYC's other sites (grounding-ai-with-ny-open-data,
   assets/js/site-nav.js; New-York-City-Budget, viz/site_shell.py): show the
   button, hide the links until it is opened, keep aria-expanded true to the
   state, and close on Escape. This site's links are often anchors on the same
   page, so following one closes the menu too.
   Without this script the button stays hidden and the links wrap under the name.
   Copy this file as is. It fetches nothing. */
(function () {
  function init() {
    var bar = document.querySelector(".site-bar");
    var btn = bar && bar.querySelector(".menu-btn");
    var list = btn && document.getElementById(btn.getAttribute("aria-controls"));
    if (!btn || !list) return;
    bar.classList.add("js");
    btn.hidden = false;
    function set(open) {
      list.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    btn.addEventListener("click", function () {
      set(btn.getAttribute("aria-expanded") !== "true");
    });
    list.addEventListener("click", function (e) {
      if (e.target.closest("a")) set(false);
    });
    bar.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") {
        set(false);
        btn.focus();
      }
    });
    // Close when focus moves out of the bar (Tab past the last link, or a
    // click elsewhere), and when the window widens past the phone layout.
    bar.addEventListener("focusout", function (e) {
      if (e.relatedTarget && !bar.contains(e.relatedTarget)) set(false);
    });
    var wide = window.matchMedia && window.matchMedia("(min-width: 782px)");
    if (wide && wide.addEventListener) {
      wide.addEventListener("change", function (e) { if (e.matches) set(false); });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
