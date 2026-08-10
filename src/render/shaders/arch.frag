#version 300 es
precision highp float;
in vec3 vN; in vec3 vPv; in vec2 vUV; in vec3 vCol; in vec3 vLp; in float vMat;
uniform vec3 uFog; uniform float uSigma; uniform float uAlpha;
uniform vec3 uAmb; uniform vec3 uUpV;
uniform sampler2D uPlaster; uniform sampler2D uParquet;
/* Baked once per room, from the fill light looking down. uShadowIdx is which
   packed light it belongs to, or -1 when this room has none. */
uniform highp sampler2DShadow uShadow; uniform mat4 uShadowMat; uniform int uShadowIdx;
uniform int uNL;
uniform vec4 uLPos[10];   // xyz view-space position, w 1/range²
uniform vec4 uLDir[10];   // xyz view-space axis,     w cos(outer)
uniform vec4 uLCol[10];   // rgb colour·intensity,    w cos(inner)
out vec4 o;
void main(){
  vec3 n = normalize(vN);
  vec3 vdir = normalize(-vPv);
  if (dot(n, vdir) < 0.0) n = -n;
  /* material grain */
  vec3 alb = vCol;
  if (vMat < 0.5)      alb *= texture(uPlaster, vUV * 0.5).rgb;
  else if (vMat < 1.5) alb *= texture(uParquet, vUV * 0.5).rgb;
  /* analytic corner occlusion — rooms are boxes, so distance to the two
     other surface planes is a fine stand-in for baked AO */
  vec3 dd = vec3(6.76 - abs(vLp.x), min(vLp.y, 4.2 - vLp.y), 6.76 - abs(vLp.z));
  vec3 gg = 0.66 + 0.34 * clamp(dd / 0.85, 0.0, 1.0);
  float ao = min(1.0, gg.x * gg.y * gg.z * 1.515);
  /* Occlusion belongs to the ambient term alone. This used to be `acc *= ao`
     after the loop, which dimmed a spotlight's own pool wherever it crossed a
     corner — light does not stop arriving because a wall is nearby. */
  vec3 acc = uAmb * alb * ao;
  float gloss = smoothstep(0.86, 0.99, dot(n, uUpV));

  /* How much of the fill light reaches here. vLp is already room-local, which
     is the space the map was baked in, so no room offset enters this. */
  float lit = 1.0;
  if (uShadowIdx >= 0){
    vec4 sc = uShadowMat * vec4(vLp, 1.0);
    vec3 pc = sc.xyz / sc.w * 0.5 + 0.5;
    if (sc.w > 0.0 && pc.x > 0.0 && pc.x < 1.0 && pc.y > 0.0 && pc.y < 1.0 && pc.z < 1.0){
      /* Slope-scaled bias: a surface seen edge-on by the light spans more
         depth per texel, and a fixed bias either acnes the floor or peels the
         shadow off whatever casts it. */
      vec3 Ls = normalize(uLPos[uShadowIdx].xyz - vPv);
      float bias = mix(0.0022, 0.0004, clamp(dot(n, Ls), 0.0, 1.0));
      float s = 0.0;
      /* Four taps on the diagonals; the comparison sampler bilinearly filters
         each one, so this is sixteen effective samples for four fetches. */
      vec2 tx = vec2(2.9 / 512.0);
      s += texture(uShadow, vec3(pc.xy + vec2( tx.x,  tx.y), pc.z - bias));
      s += texture(uShadow, vec3(pc.xy + vec2(-tx.x,  tx.y), pc.z - bias));
      s += texture(uShadow, vec3(pc.xy + vec2( tx.x, -tx.y), pc.z - bias));
      s += texture(uShadow, vec3(pc.xy + vec2(-tx.x, -tx.y), pc.z - bias));
      /* Fade the map out at its edge rather than ending it with a hard line. */
      vec2 e = abs(pc.xy - 0.5) * 2.0;
      float edge = 1.0 - smoothstep(0.82, 0.99, max(e.x, e.y));
      /* Never fully black. A shadow in a real room is filled by light bounced
         off everything around it, and a hard zero here reads as a hole cut in
         the floor rather than as shade. */
      lit = mix(1.0, mix(0.14, 1.0, s * 0.25), edge);
    }
  }
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
    if (i == uShadowIdx) c *= lit;
    acc += alb * c * max(dot(n, L), 0.0);
    vec3 hv = normalize(L + vdir);
    acc += c * pow(max(dot(n, hv), 0.0), 56.0) * gloss * 0.65;
  }
  float f = 1.0 - exp(-uSigma * length(vPv));
  o = vec4(mix(acc, uFog, f), uAlpha);
}
