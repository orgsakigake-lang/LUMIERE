#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLightMat;
void main(){ gl_Position = uLightMat * vec4(aPos, 1.0); }
