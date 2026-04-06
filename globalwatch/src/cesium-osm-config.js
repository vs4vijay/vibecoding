// CesiumJS + OpenStreetMap Configuration
// GlobalWatch Project

export const TILE_CONFIG = {
  // OpenStreetMap standard tiles - no API key required
  // Format: https://tile.openstreetmap.org/{z}/{x}/{y}.png
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  
  // Attribution - required by OSM license
  attribution: `© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors`,
  
  // Zoom level limits for OSM tiles
  minZoom: 0,
  maxZoom: 19,
  
  // Tile size (OSM standard)
  tileWidth: 256,
  tileHeight: 256
};

export const CESIUM_CONFIG = {
  // Use WGS84 ellipsoid for global coverage
  ellipsoid: Cesium.Ellipsoid.WGS84,
  
  // Enable depth testing for proper terrain rendering
  depthTestAgainstTerrain: true,
  
  // Enable sun lighting on the globe
  enableLighting: true,
  
  // Base layer picker enabled
  baseLayerPicker: true,
  
  // Widgets configuration
  widgets: {
    timeline: false,
    animation: false,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    selectionIndicator: true,
    infoBox: true,
    fullscreenButton: false
  }
};

/**
 * Creates the OpenStreetMap imagery provider for Cesium
 * @returns {Cesium.UrlTemplateImageryProvider}
 */
export function createOsmImageryProvider() {
  return new Cesium.UrlTemplateImageryProvider({
    url: TILE_CONFIG.url,
    credit: new Cesium.Credit(TILE_CONFIG.attribution, true),
    minimumLevel: TILE_CONFIG.minZoom,
    maximumLevel: TILE_CONFIG.maxZoom,
    ellipsoid: TILE_CONFIG.ellipsoid
  });
}

/**
 * Initialize Cesium Viewer with OpenStreetMap tiles
 * @param {string} containerId - DOM element ID for the viewer
 * @returns {Cesium.Viewer}
 */
export function createViewer(containerId) {
  const osmProvider = createOsmImageryProvider();
  
  return new Cesium.Viewer(containerId, {
    imageryProvider: osmProvider,
    baseLayerPicker: CESIUM_CONFIG.widgets.baseLayerPicker,
    timeline: CESIUM_CONFIG.widgets.timeline,
    animation: CESIUM_CONFIG.widgets.animation,
    sceneMode: Cesium.SceneMode.SCENE3D,
    geocoder: CESIUM_CONFIG.widgets.geocoder,
    homeButton: CESIUM_CONFIG.widgets.homeButton,
    sceneModePicker: CESIUM_CONFIG.widgets.sceneModePicker,
    navigationHelpButton: CESIUM_CONFIG.widgets.navigationHelpButton,
    selectionIndicator: CESIUM_CONFIG.widgets.selectionIndicator,
    infoBox: CESIUM_CONFIG.widgets.infoBox,
    fullscreenButton: CESIUM_CONFIG.widgets.fullscreenButton
  });
}
