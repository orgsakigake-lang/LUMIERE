#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir;
out vec4 o;
void main(){
  vec3 acc = texture(uTex, vUV).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846154, o2 = uDir * 3.2307692;
  acc += texture(uTex, vUV + o1).rgb * 0.3162162;
  acc += texture(uTex, vUV - o1).rgb * 0.3162162;
  acc += texture(uTex, vUV + o2).rgb * 0.0702703;
  acc += texture(uTex, vUV - o2).rgb * 0.0702703;
  o = vec4(acc, 1.0);
}
