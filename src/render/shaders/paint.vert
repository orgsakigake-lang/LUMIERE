#version 300 es
layout(location=0) in vec2 aQ;
uniform mat4 uMV, uP;
uniform vec3 uO, uU, uV;
out vec2 vUV; out vec3 vPv;
void main(){
  vec3 p = uO + uU*aQ.x + uV*aQ.y;
  vec4 pv = uMV * vec4(p, 1.0);
  vPv = pv.xyz; vUV = vec2(aQ.x, 1.0 - aQ.y);
  gl_Position = uP * pv;
}
