#version 300 es
layout(location=0) in vec3 aP;
uniform mat4 uMV, uP; uniform float uTime; uniform float uMY;
uniform float uEyeY;        // the camera's height, in world metres
out float vF;
void main(){
  vec3 p = vec3(aP.x, mix(aP.y, -aP.y, uMY), aP.z);
  vec4 pv = uMV * vec4(p, 1.0);
  gl_Position = uP * pv;
  float h = fract(sin(aP.x*37.7 + aP.z*91.3)*43758.5);
  vF = 0.70 + 0.30*sin(uTime*(5.0 + h*4.0) + h*40.0);
  /* A point sprite is depth-tested at its centre alone, so a jump that
     carries the eye up level with the chandelier made whole flames wink
     off against their own fixture. Ease them out as the eye rises instead:
     from above, a candle is mostly wick anyway. */
  vF *= smoothstep(0.05, 0.55, aP.y - uEyeY);
  gl_PointSize = clamp(40.0 / max(1.0, -pv.z), 2.5, 20.0);
}
