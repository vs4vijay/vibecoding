/**
 * Visual Mode Shaders for GlobalWatch
 * 
 * Post-processing effects for military-style visualization:
 * - Standard: Default Cesium view
 * - NVG: Night Vision Green (military night optics)
 * - FLIR: Forward-Looking Infrared (thermal imaging)
 * - CRT: Retro CRT scanlines effect
 * - Anime: Cel-shading (Studio Ghibli style)
 */

import { Viewer, PostProcessStage } from 'cesium';

export type VisualMode = 'standard' | 'nvg' | 'flir' | 'crt' | 'anime';

// NVG (Night Vision Green) shader
const NVG_SHADER = `
  uniform sampler2D colorTexture;
  varying vec2 v_textureCoordinates;
  
  void main() {
    vec4 color = texture2D(colorTexture, v_textureCoordinates);
    
    // Convert to luminance
    float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    
    // Apply green tint with gain
    float gain = 1.5;
    float intensified = pow(luminance, 0.8) * gain;
    
    // Night vision green color
    vec3 nvgColor = vec3(0.1, intensified, 0.05);
    
    // Add some noise for realism
    float noise = fract(sin(dot(v_textureCoordinates, vec2(12.9898, 78.233))) * 43758.5453);
    nvgColor += noise * 0.03;
    
    gl_FragColor = vec4(nvgColor, color.a);
  }
`;

// FLIR (Thermal) shader
const FLIR_SHADER = `
  uniform sampler2D colorTexture;
  varying vec2 v_textureCoordinates;
  
  void main() {
    vec4 color = texture2D(colorTexture, v_textureCoordinates);
    
    // Convert to luminance (thermal intensity)
    float thermal = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    
    // Invert for thermal look (hot = bright)
    float inverted = 1.0 - thermal;
    
    // Thermal color palette (black -> blue -> red -> yellow -> white)
    vec3 thermalColor;
    if (inverted < 0.25) {
      thermalColor = mix(vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.5), inverted * 4.0);
    } else if (inverted < 0.5) {
      thermalColor = mix(vec3(0.0, 0.0, 0.5), vec3(0.5, 0.0, 0.0), (inverted - 0.25) * 4.0);
    } else if (inverted < 0.75) {
      thermalColor = mix(vec3(0.5, 0.0, 0.0), vec3(1.0, 0.5, 0.0), (inverted - 0.5) * 4.0);
    } else {
      thermalColor = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 1.0, 1.0), (inverted - 0.75) * 4.0);
    }
    
    gl_FragColor = vec4(thermalColor, color.a);
  }
`;

// CRT Scanlines shader
const CRT_SHADER = `
  uniform sampler2D colorTexture;
  uniform float time;
  varying vec2 v_textureCoordinates;
  
  void main() {
    vec4 color = texture2D(colorTexture, v_textureCoordinates);
    
    // Scanlines
    float scanline = sin(v_textureCoordinates.y * 400.0) * 0.04;
    color.rgb -= scanline;
    
    // Vignette
    vec2 uv = v_textureCoordinates;
    float vignette = 1.0 - length(uv * 2.0 - 1.0) * 0.3;
    color.rgb *= vignette;
    
    // Slight chromatic aberration
    float aberration = 0.002;
    color.r = texture2D(colorTexture, uv + vec2(aberration, 0.0)).r;
    color.b = texture2D(colorTexture, uv - vec2(aberration, 0.0)).b;
    
    // Subtle flicker
    float flicker = 0.97 + 0.03 * sin(time * 10.0);
    color.rgb *= flicker;
    
    gl_FragColor = color;
  }
`;

// Anime Cel-shading shader
const ANIME_SHADER = `
  uniform sampler2D colorTexture;
  varying vec2 v_textureCoordinates;
  
  void main() {
    vec4 color = texture2D(colorTexture, v_textureCoordinates);
    
    // Posterize colors (cel-shading effect)
    float levels = 4.0;
    vec3 posterized = floor(color.rgb * levels) / levels;
    
    // Boost saturation for anime look
    float gray = dot(posterized, vec3(0.299, 0.587, 0.114));
    vec3 saturated = mix(vec3(gray), posterized, 1.5);
    
    // Warm color grading
    saturated.r *= 1.1;
    saturated.b *= 0.9;
    
    // Clamp
    saturated = clamp(saturated, 0.0, 1.0);
    
    gl_FragColor = vec4(saturated, color.a);
  }
`;

let currentStage: PostProcessStage | null = null;

/**
 * Apply a visual mode to the Cesium viewer
 */
export function applyVisualMode(viewer: Viewer, mode: VisualMode): void {
  // Remove existing stage
  if (currentStage) {
    viewer.postProcessStages.remove(currentStage);
    currentStage = null;
  }

  // Return early for standard mode
  if (mode === 'standard') {
    return;
  }

  // Create and add new stage
  let fragmentShader: string;
  
  switch (mode) {
    case 'nvg':
      fragmentShader = NVG_SHADER;
      break;
    case 'flir':
      fragmentShader = FLIR_SHADER;
      break;
    case 'crt':
      fragmentShader = CRT_SHADER;
      break;
    case 'anime':
      fragmentShader = ANIME_SHADER;
      break;
    default:
      return;
  }

  currentStage = new PostProcessStage({
    fragmentShader,
    uniforms: mode === 'crt' ? { time: 0.0 } : undefined,
  });

  viewer.postProcessStages.add(currentStage);
}

/**
 * Update shader uniforms (for animated effects like CRT)
 */
export function updateVisualModeUniforms(time: number): void {
  if (currentStage && currentStage.uniforms && 'time' in currentStage.uniforms) {
    currentStage.uniforms.time = time;
  }
}
