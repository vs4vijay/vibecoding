// PWA Service Worker Registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/js/sw.js")
      .then((reg) => {
        console.log("✅ Service Worker registered:", reg.scope);
      })
      .catch((err) => {
        console.log("❌ Service Worker registration failed:", err);
      });
  });
}
