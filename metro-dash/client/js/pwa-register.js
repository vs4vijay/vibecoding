// PWA Service Worker Registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Relative path + default scope so the PWA works under any subpath
    // (GitHub Pages /vibecoding/metro-dash/) as well as at the repo root.
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => {
        console.log("✅ Service Worker registered:", reg.scope);
      })
      .catch((err) => {
        console.log("❌ Service Worker registration failed:", err);
      });
  });
}
