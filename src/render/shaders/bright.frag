#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uTex;
out vec4 o;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  o = vec4(c * smoothstep(0.62, 1.05, l), 1.0);
}
