#version 300 es
layout(location=0) in vec2 aQ;
out vec2 vUV;
void main(){ vUV = aQ; gl_Position = vec4(aQ*2.0 - 1.0, 0.0, 1.0); }
