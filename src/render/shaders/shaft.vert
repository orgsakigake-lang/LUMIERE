#version 300 es
layout(location=0) in vec2 aQ;
uniform mat4 uMV, uP;
uniform vec3 uC; uniform vec2 uAxis; uniform vec2 uDim;
out vec2 vQ;
void main(){
  vec3 p = vec3(uC.x + uAxis.x*(aQ.x-0.5)*uDim.x, aQ.y*uDim.y, uC.z + uAxis.y*(aQ.x-0.5)*uDim.x);
  vQ = aQ;
  gl_Position = uP * (uMV * vec4(p, 1.0));
}
