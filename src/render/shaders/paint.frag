#version 300 es
precision highp float;
in vec2 vUV; in vec3 vPv;
uniform sampler2D uTex;
uniform vec3 uN;            // view-space surface normal
uniform vec3 uFog; uniform float uSigma; uniform float uFade; uniform float uEm;
uniform float uGlaze;       // 0 varnish on canvas, 1 glass over a mounted work
uniform float uAT;          // 1 → texture alpha shapes the quad (contact shadows)
uniform float uRain;        // 0 dry → 1 downpour; only the sky quads ever raise it
uniform float uTime;        // the shared shader clock, pinned by DBG.freeze
uniform int uNL;
uniform vec4 uLPos[10]; uniform vec4 uLDir[10]; uniform vec4 uLCol[10];
out vec4 o;
void main(){
  vec4 t = texture(uTex, vUV);
  vec3 alb = t.rgb;
  vec3 n = normalize(uN);
  vec3 vdir = normalize(-vPv);
  if (dot(n, vdir) < 0.0) n = -n;
  vec3 acc = alb * uEm;
  for (int i = 0; i < 10; i++){   // MAX_LIGHTS in world/geometry.js
    if (i >= uNL) break;
    vec3 L = uLPos[i].xyz - vPv;
    float d2 = max(dot(L, L), 1e-4);
    float dist = sqrt(d2);
    L /= dist;
    /* Inverse square, windowed to reach exactly zero at the light's range.
       This replaced 1/(1 + d²/R²), which varies only 2.15:1 across a room
       where physics varies 16:1 and never reaches zero — every light lit every
       fragment at a near-constant level, which is why the pools read as
       painted gradients rather than as light. */
    float rr = d2 * uLPos[i].w;                       // (d/R)²
    float win = clamp(1.0 - rr*rr, 0.0, 1.0);
    float att = win * win / (d2 + 1.0);
    float cone = smoothstep(uLDir[i].w, uLCol[i].w, dot(-L, uLDir[i].xyz));
    float reach = att * cone;
    if (reach <= 0.0004) continue;                    // outside the beam: skip the rest
    vec3 c = uLCol[i].rgb * reach;
    acc += alb * c * max(dot(n, L), 0.0);
    vec3 hv = normalize(L + vdir);
    /* Varnish on canvas is a broad soft sheen; glass over a mounted work is a
       tighter, brighter one. */
    acc += c * pow(max(dot(n, hv), 0.0), mix(24.0, 130.0, uGlaze)) * mix(0.055, 0.14, uGlaze);
  }
  /* What actually reads as glazing is not the highlight but the veil: at a
     grazing angle the glass starts reflecting the room instead of showing the
     sheet. uEm carries how lit the room is, so the veil follows the lamps.
     Clamped, because the term runs away at the last few degrees. */
  if (uGlaze > 0.0){
    float fres = pow(1.0 - max(dot(n, vdir), 0.0), 5.0);
    acc += vec3(uEm * uGlaze * min(fres, 0.45) * 0.9);
  }
  /* ————— weather on the glass —————
     Every painting keeps uRain at 0, so this costs them one coherent branch.
     Two things sell rain through a window: the sky goes overcast — grey,
     dimmer, a touch cool — and rivulets run down the pane. The rivulets are
     texture-space columns with per-column phase, two layers at different
     scales and speeds so no repetition ever lines up. */
  if (uRain > 0.0){
    float lum = dot(acc, vec3(0.299, 0.587, 0.114));
    acc = mix(acc, vec3(lum) * vec3(0.86, 0.92, 1.04) * 0.5, uRain * 0.62);
    float s = 0.0;
    for (int k = 0; k < 2; k++){
      float x = vUV.x * (k == 0 ? 26.0 : 43.0) + float(k) * 7.31;
      float ph = fract(sin(floor(x) * 127.1) * 43758.5453);
      float y = fract(vUV.y * 1.35 + uTime * (k == 0 ? 0.9 : 1.5) + ph * 9.0);
      float w = abs(fract(x) - 0.5);
      s += step(ph, 0.62) * smoothstep(0.10, 0.0, w) * smoothstep(0.42, 0.0, y)
         * (k == 0 ? 1.0 : 0.6);
    }
    acc += vec3(s * uRain * uEm * 0.20);
  }
  float f = 1.0 - exp(-uSigma * length(vPv));
  o = vec4(mix(acc, uFog, f), uFade * mix(1.0, t.a, uAT));
}
