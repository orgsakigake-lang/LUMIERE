#version 300 es
precision highp float;
in vec3 vN; in vec3 vPv; in vec2 vUV; in vec3 vCol; in vec3 vLp; in float vMat;
uniform vec3 uFog; uniform float uSigma; uniform float uAlpha;
uniform vec3 uAmb; uniform vec3 uUpV;
uniform sampler2D uPlaster; uniform sampler2D uParquet;
uniform int uNL;
uniform vec4 uLPos[8];   // xyz view-space position, w 1/range²
uniform vec4 uLDir[8];   // xyz view-space axis,     w cos(outer)
uniform vec4 uLCol[8];   // rgb colour·intensity,    w cos(inner)
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
  vec3 acc = uAmb * alb;
  float gloss = smoothstep(0.86, 0.99, dot(n, uUpV));
  for (int i = 0; i < 8; i++){
    if (i >= uNL) break;
    vec3 L = uLPos[i].xyz - vPv;
    float d2 = dot(L, L);
    float dist = sqrt(d2);
    L /= dist;
    float att = 1.0 / (1.0 + d2 * uLPos[i].w);
    float cone = smoothstep(uLDir[i].w, uLCol[i].w, dot(-L, uLDir[i].xyz));
    vec3 c = uLCol[i].rgb * (att * cone);
    acc += alb * c * max(dot(n, L), 0.0);
    vec3 hv = normalize(L + vdir);
    acc += c * pow(max(dot(n, hv), 0.0), 56.0) * gloss * 0.65;
  }
  acc *= ao;
  float f = 1.0 - exp(-uSigma * length(vPv));
  o = vec4(mix(acc, uFog, f), uAlpha);
}
