// This file must be imported before any Cesium imports
// It sets up the base URL for Cesium's static assets

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.CESIUM_BASE_URL = '/cesium/';
}
