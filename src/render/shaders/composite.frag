#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex; uniform sampler2D uBloom;
uniform float uTime; uniform vec2 uRes;
out vec4 o;
vec3 aces(vec3 x){
  return clamp((x*(2.51*x + 0.03)) / (x*(2.43*x + 0.59) + 0.14), 0.0, 1.0);
}
float hash(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main(){
  vec3 c = texture(uTex, vUV).rgb + texture(uBloom, vUV).rgb * 0.9;
  c = aces(c * 1.35);
  /* split-tone: cool shadows, warm lights — the film look of old halls */
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c *= mix(vec3(0.965, 0.99, 1.065), vec3(1.045, 1.0, 0.945), smoothstep(0.04, 0.62, lum));
  vec2 vg = vUV - 0.5;
  c *= 1.0 - 0.34 * smoothstep(0.28, 0.72, dot(vg, vg));
  c += (hash(vUV * uRes + fract(uTime)*371.0) - 0.5) * 0.028;
  o = vec4(c, 1.0);
}
