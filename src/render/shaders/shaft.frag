#version 300 es
precision highp float;
in vec2 vQ; uniform vec3 uCol; uniform float uTime;
out vec4 o;
void main(){
  float ax = 1.0 - abs(vQ.x - 0.5)*2.0;
  float ay = 1.0 - vQ.y*0.78;
  float a = ax*ax*ay*0.11*(0.82 + 0.18*sin(uTime*0.37 + vQ.y*5.0));
  o = vec4(uCol*a, 0.0);
}
