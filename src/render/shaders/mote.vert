#version 300 es
layout(location=0) in vec4 aS;
uniform mat4 uMV, uP;
uniform vec3 uC; uniform vec2 uDim; uniform float uTime;
out float vA;
void main(){
  float ph = fract(aS.y + uTime*0.016 + uC.x*0.13);
  float wob = sin(uTime*aS.w*2.0 + aS.x*23.0)*0.14;
  vec3 p = vec3(uC.x + (aS.x-0.5)*uDim.x*0.8 + wob,
                ph*uDim.y,
                uC.z + (aS.z-0.5)*uDim.x*0.8 + wob*0.7);
  vec4 pv = uMV * vec4(p, 1.0);
  gl_Position = uP * pv;
  gl_PointSize = clamp(9.0 / max(1.0, -pv.z), 1.5, 5.0);
  vA = (0.55 + 0.45*sin(uTime*1.7 + aS.x*40.0)) * smoothstep(0.0, 0.12, ph) * smoothstep(1.0, 0.82, ph);
}
