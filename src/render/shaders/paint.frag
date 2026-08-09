#version 300 es
precision highp float;
in vec2 vUV; in vec3 vPv;
uniform sampler2D uTex;
uniform vec3 uN;            // view-space surface normal
uniform vec3 uFog; uniform float uSigma; uniform float uFade; uniform float uEm;
uniform float uAT;          // 1 → texture alpha shapes the quad (contact shadows)
uniform int uNL;
uniform vec4 uLPos[8]; uniform vec4 uLDir[8]; uniform vec4 uLCol[8];
out vec4 o;
void main(){
  vec4 t = texture(uTex, vUV);
  vec3 alb = t.rgb;
  vec3 n = normalize(uN);
  vec3 vdir = normalize(-vPv);
  if (dot(n, vdir) < 0.0) n = -n;
  vec3 acc = alb * uEm;
  for (int i = 0; i < 8; i++){
    if (i >= uNL) break;
    vec3 L = uLPos[i].xyz - vPv;
    float d2 = dot(L, L); float dist = sqrt(d2); L /= dist;
    float att = 1.0 / (1.0 + d2 * uLPos[i].w);
    float cone = smoothstep(uLDir[i].w, uLCol[i].w, dot(-L, uLDir[i].xyz));
    vec3 c = uLCol[i].rgb * (att * cone);
    acc += alb * c * max(dot(n, L), 0.0);
    vec3 hv = normalize(L + vdir);
    acc += c * pow(max(dot(n, hv), 0.0), 24.0) * 0.055;   // varnish sheen
  }
  float f = 1.0 - exp(-uSigma * length(vPv));
  o = vec4(mix(acc, uFog, f), uFade * mix(1.0, t.a, uAT));
}
