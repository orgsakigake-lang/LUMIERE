#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aCol;
layout(location=4) in float aMat;
uniform mat4 uMV, uP;
out vec3 vN; out vec3 vPv; out vec2 vUV; out vec3 vCol; out vec3 vLp; out float vMat;
void main(){
  vec4 pv = uMV * vec4(aPos, 1.0);
  vPv = pv.xyz;
  vN = mat3(uMV) * aNor;
  vUV = aUV; vCol = aCol; vLp = aPos; vMat = aMat;
  gl_Position = uP * pv;
}
