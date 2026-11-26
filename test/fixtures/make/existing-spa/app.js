// Home is drawn here; other routes come from window.Screens. A route with no screen falls back to Home.
function home(v) { v.innerHTML = `<h1>Today</h1><p>Two orders ship today.</p>`; }
function show() {
  const id = (location.hash.replace(/^#\//, "") || "home").split("/")[0];
  const v = document.getElementById("view");
  (window.Screens[id] || home)(v);
}
window.addEventListener("hashchange", show);
show();
