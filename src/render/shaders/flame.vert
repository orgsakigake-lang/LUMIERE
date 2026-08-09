#version 300 es
layout(location=0) in vec3 aP;
uniform mat4 uMV, uP; uniform float uTime; uniform float uMY;
out float vF;
void main(){
  vec3 p = vec3(aP.x, mix(aP.y, -aP.y, uMY), aP.z);
  vec4 pv = uMV * vec4(p, 1.0);
  gl_Position = uP * pv;
  float h = fract(sin(aP.x*37.7 + aP.z*91.3)*43758.5);
  vF = 0.70 + 0.30*sin(uTime*(5.0 + h*4.0) + h*40.0);
  gl_PointSize = clamp(40.0 / max(1.0, -pv.z), 2.5, 20.0);
}
