// Progressive-enhancement PWA glue. No-ops where unsupported; never throws to the app.

// Ask the browser to keep our data (reduces iOS 7-day eviction risk). Harmless if unsupported/denied.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

// Register the service worker (relative path → correct under the /car-service/app/ sub-path).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});

    // When a new worker takes control (after an update), reload once so the user gets the new version.
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  });
}
