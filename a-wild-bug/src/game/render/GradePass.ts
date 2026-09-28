import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

/**
 * Warm storybook grade: lift/gamma/gain, gentle saturation, soft vignette.
 * Runs in linear HDR before the OutputPass tone-maps.
 */
export function createGradePass(): ShaderPass {
  const shader = {
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uLift: { value: new THREE.Vector3(0.016, 0.013, 0.01) },
      uDuskLift: { value: 0 }, // 0 noon → 1 at dawn/dusk (set by Game)
      uGamma: { value: new THREE.Vector3(1.02, 1.0, 0.965) },
      uGain: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
      uSaturation: { value: 1.14 },
      uVignette: { value: 0.32 },
      uNearBlur: { value: 0 }, // 0..1 closeup near-field melt (set per shot)
      uSting: { value: 0 }, // 0..1 steal "sting" pulse (set by Game from the loop)
      uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform vec3 uLift;
      uniform float uDuskLift;
      uniform vec3 uGamma;
      uniform vec3 uGain;
      uniform float uSaturation;
      uniform float uVignette;
      uniform float uNearBlur;
      uniform float uSting;
      uniform vec2 uTexel;
      void main() {
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        // Near-field melt for closeup framings: a cheap 8-tap radial blur
        // whose weight peaks at the frame edges, so the half-metre foreground
        // goes soft while the subject at frame center stays crisp.
        if (uNearBlur > 0.001) {
          float r = length((vUv - 0.5) * vec2(1.0, 1.15));
          float m = smoothstep(0.42, 0.95, r) * uNearBlur;
          if (m > 0.003) {
            vec2 px = uTexel * 6.0 * uNearBlur;
            vec3 acc = col * 0.25;
            float wsum = 0.25;
            acc += texture2D(tDiffuse, vUv + px * vec2( 0.958,  0.286)).rgb * 0.09375; wsum += 0.09375;
            acc += texture2D(tDiffuse, vUv + px * vec2( 0.279,  0.960)).rgb * 0.09375; wsum += 0.09375;
            acc += texture2D(tDiffuse, vUv + px * vec2(-0.827,  0.562)).rgb * 0.09375; wsum += 0.09375;
            acc += texture2D(tDiffuse, vUv + px * vec2(-0.702, -0.712)).rgb * 0.09375; wsum += 0.09375;
            acc += texture2D(tDiffuse, vUv + px * vec2( 0.153, -0.988)).rgb * 0.09375; wsum += 0.09375;
            acc += texture2D(tDiffuse, vUv + px * vec2( 0.652, -0.312)).rgb * 0.046875; wsum += 0.046875;
            acc += texture2D(tDiffuse, vUv + px * vec2(-0.283, -0.400)).rgb * 0.046875; wsum += 0.046875;
            acc += texture2D(tDiffuse, vUv + px * vec2( 0.412,  0.640)).rgb * 0.046875; wsum += 0.046875;
            col = mix(col, acc / wsum, m);
          }
        }
        // Sting beat (the grasshopper's snatch): a stronger radial smear that
        // reaches toward the frame center plus a hot red-amber flush at the
        // edges — same 8-tap family as the near-field melt, brief by design.
        if (uSting > 0.003) {
          vec2 sd = vUv - 0.5;
          float sr = length(sd * vec2(1.0, 1.15));
          float sm = smoothstep(0.1, 0.85, sr) * uSting;
          vec2 px = uTexel * 9.0 * uSting;
          vec2 dir = normalize(sd + vec2(1e-5));
          vec3 acc = col * 0.36;
          float wsum = 0.36;
          acc += texture2D(tDiffuse, vUv + px * dir).rgb * 0.16; wsum += 0.16;
          acc += texture2D(tDiffuse, vUv - px * dir).rgb * 0.16; wsum += 0.16;
          acc += texture2D(tDiffuse, vUv + px * dir * 2.0).rgb * 0.16; wsum += 0.16;
          acc += texture2D(tDiffuse, vUv - px * dir * 2.0).rgb * 0.16; wsum += 0.16;
          col = mix(col, acc / wsum, sm * 0.75);
          col += vec3(0.34, 0.10, 0.02) * sm * uSting;
        }
        // Warm lift that grows at dawn/dusk so shadow floors never die to black.
        col = col * uGain + uLift + uDuskLift * vec3(0.024, 0.019, 0.013);
        col = pow(max(col, 0.0), vec3(1.0) / uGamma);
        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(luma), col, uSaturation);
        vec2 d = vUv - 0.5;
        float vig = smoothstep(0.92, 0.32, length(d) * 1.35);
        col *= mix(1.0, vig, uVignette);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  };
  return new ShaderPass(shader);
}
