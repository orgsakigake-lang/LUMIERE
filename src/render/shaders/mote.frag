#version 300 es
precision highp float;
in float vA; uniform vec3 uCol;
out vec4 o;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  o = vec4(uCol * smoothstep(0.5, 0.12, length(d)) * vA * 0.5, 0.0);
}
