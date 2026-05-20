import { GlProgram, GpuProgram, Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';

// Shared unit-quad geometry: positions in [0,1] × [0,1] so the fragment
// shader can read aUV as the local coordinate directly. Sized into world
// space by each mesh's transform (mesh.scale = 2*radius, mesh.x/y = center).
const QUAD_POSITIONS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

let sharedQuadGeometry: MeshGeometry | null = null;
function getQuadGeometry(): MeshGeometry {
  if (!sharedQuadGeometry) {
    sharedQuadGeometry = new MeshGeometry({
      positions: QUAD_POSITIONS,
      uvs: QUAD_UVS,
      indices: QUAD_INDICES,
    });
  }
  return sharedQuadGeometry;
}

// Both programs declare the Pixi-conventional `globalUniforms` (group 0) and
// `localUniforms` (group 1) blocks — the WebGL/WebGPU mesh adaptors detect
// these by name and auto-assign the projection/transform matrices each draw.
// Our custom uniforms live in `lightUniforms` (group 2 in WGSL; matched by
// name in GLSL).
const VERT_GLSL = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
uniform globalUniforms {
  mat3 uProjectionMatrix;
  mat3 uWorldTransformMatrix;
  vec4 uWorldColorAlpha;
  vec2 uResolution;
};
uniform localUniforms {
  mat3 uTransformMatrix;
  vec4 uColor;
  float uRound;
};
out vec2 vUV;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAG_GLSL = `#version 300 es
precision mediump float;
in vec2 vUV;
out vec4 outColor;
uniform lightUniforms {
  vec3 uTint;
  float uTime;
  float uCoreSize;
};
void main() {
  vec2 d = vUV - vec2(0.5);
  float r = length(d) * 2.0;
  // Solid core out to uCoreSize, then quadratic falloff to zero at r=1.
  // Linear ramp first; squaring after the clamp gives a smoother roll-off
  // than a single pow(1-r, n) without a core.
  float t = clamp(1.0 - (r - uCoreSize) / (1.0 - uCoreSize), 0.0, 1.0);
  // Scale the peak contribution down so a bright tint + the night ambient
  // stays under the per-channel LDR cap. Without this, torch centers
  // saturate to white and the tint only reads at the bubble's edge.
  float intensity = t * t * 0.55;
  // uTime is plumbed but unused — reserved for a future torch flicker pass
  // (e.g. intensity *= 1.0 + 0.05 * sin(uTime * 6.0)) without CPU work.
  outColor = vec4(uTint * intensity, intensity);
}`;

const WGSL = `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
}
struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
}
struct LightUniforms {
  uTint: vec3<f32>,
  uTime: f32,
  uCoreSize: f32,
}
@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> lightUniforms: LightUniforms;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) vUV: vec2<f32>,
};

@vertex
fn mainVert(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>) -> VSOut {
  let mvp = globalUniforms.uProjectionMatrix
          * globalUniforms.uWorldTransformMatrix
          * localUniforms.uTransformMatrix;
  let p = mvp * vec3<f32>(aPosition, 1.0);
  var out: VSOut;
  out.position = vec4<f32>(p.xy, 0.0, 1.0);
  out.vUV = aUV;
  return out;
}

@fragment
fn mainFrag(input: VSOut) -> @location(0) vec4<f32> {
  let d = input.vUV - vec2<f32>(0.5);
  let r = length(d) * 2.0;
  let t = clamp(1.0 - (r - lightUniforms.uCoreSize) / (1.0 - lightUniforms.uCoreSize), 0.0, 1.0);
  // See GLSL fragment: scale down so tint + ambient stays under the LDR cap.
  let intensity = t * t * 0.55;
  return vec4<f32>(lightUniforms.uTint * intensity, intensity);
}`;

// Programs are cached by source string, so the per-mesh Shader instances
// below share the same compiled GPU/GL program — only the uniform group
// (group 2) is unique per light.
function getGlProgram(): GlProgram {
  return GlProgram.from({ name: 'light-bubble', vertex: VERT_GLSL, fragment: FRAG_GLSL });
}
function getGpuProgram(): GpuProgram {
  return GpuProgram.from({
    name: 'light-bubble',
    vertex: { source: WGSL, entryPoint: 'mainVert' },
    fragment: { source: WGSL, entryPoint: 'mainFrag' },
  });
}

export interface LightMesh {
  mesh: Mesh<MeshGeometry, Shader>;
  /** Mutate uniforms directly through this group. Cheaper than re-setting the resource each frame. */
  uniforms: { uTint: Float32Array; uTime: number; uCoreSize: number };
}

/**
 * Build a fresh light-bubble Mesh: shared quad geometry + a Shader with its
 * own `lightUniforms` group. Caller positions and scales the mesh; updates
 * `uTint`/`uTime`/`uCoreSize` via the returned `uniforms` object.
 */
export function createLightMesh(): LightMesh {
  const lightUniforms = new UniformGroup({
    uTint: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
    uTime: { value: 0, type: 'f32' },
    uCoreSize: { value: 0.1, type: 'f32' },
  });
  const shader = new Shader({
    glProgram: getGlProgram(),
    gpuProgram: getGpuProgram(),
    resources: { lightUniforms },
  });
  // Generic Shader (not the default TextureShader) — our shader doesn't
  // sample a texture, so the parameterized type stays Shader.
  const mesh = new Mesh<MeshGeometry, Shader>({ geometry: getQuadGeometry(), shader });
  mesh.blendMode = 'add';
  return {
    mesh,
    uniforms: lightUniforms.uniforms as unknown as LightMesh['uniforms'],
  };
}
