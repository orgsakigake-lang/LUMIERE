#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex; uniform sampler2D uBloom;
uniform float uTime; uniform vec2 uRes;
uniform float uExposure; uniform float uGrain;
out vec4 o;
vec3 aces(vec3 x){
  return clamp((x*(2.51*x + 0.03)) / (x*(2.43*x + 0.59) + 0.14), 0.0, 1.0);
}
/* The piecewise sRGB transfer, not pow(1/2.2). The linear toe is the whole
   difference in the shadows, and the shadows are most of this museum. */
vec3 toSRGB(vec3 c){
  c = max(c, vec3(0.0));
  return mix(c * 12.92,
             1.055 * pow(c, vec3(1.0/2.4)) - 0.055,
             step(vec3(0.0031308), c));
}
float hash(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main(){
  vec3 c = texture(uTex, vUV).rgb + texture(uBloom, vUV).rgb * 0.9;
  c = aces(c * uExposure);
  /* split-tone: cool shadows, warm lights — the film look of old halls */
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c *= mix(vec3(0.965, 0.99, 1.065), vec3(1.045, 1.0, 0.945), smoothstep(0.04, 0.62, lum));
  vec2 vg = vUV - 0.5;
  c *= 1.0 - 0.34 * smoothstep(0.28, 0.72, dot(vg, vg));

  /* Encode last. Without this the whole museum was displayed at L^2.2: an
     ambient-only wall computed 0.0052 and showed as 1/255 instead of 23/255,
     and the entire image lived in about 70 of the 255 code values. */
  c = toSRGB(c);

  /* Grain after the encode, so it is a constant perceptual amount rather than
     ±280% of a crushed shadow. It also dithers the 8-bit quantisation. */
  c += (hash(vUV * uRes + fract(uTime)*371.0) - 0.5) * uGrain;
  o = vec4(c, 1.0);
}
