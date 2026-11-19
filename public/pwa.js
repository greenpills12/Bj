const serviceWorkerUrl = new URL('sw.js', document.currentScript.src);

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(serviceWorkerUrl)
      .catch(error => console.warn('Offline setup failed:', error));
  });
}
