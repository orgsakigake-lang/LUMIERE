/* ═══════════════════════════════════════════════════════════════════
   Column-major 4×4 matrices and Gribb–Hartmann frustum planes.
   Zero-allocation: every routine writes into a caller-owned target.
   Pure — this module imports nothing.
   ═══════════════════════════════════════════════════════════════════ */

export function mat4(){ return new Float32Array(16); }
function ident(o){ o.fill(0); o[0]=o[5]=o[10]=o[15]=1; return o; }
export function perspective(o, fovy, asp, near, far){
  const f = 1/Math.tan(fovy/2), nf = 1/(near - far);
  o.fill(0);
  o[0]=f/asp; o[5]=f; o[10]=(far+near)*nf; o[11]=-1; o[14]=2*far*near*nf;
  return o;
}
export function mulM(o, a, b){          // o = a·b  (o must not alias a or b)
  for (let c=0; c<4; c++){
    const b0=b[c*4], b1=b[c*4+1], b2=b[c*4+2], b3=b[c*4+3];
    o[c*4  ] = a[0]*b0 + a[4]*b1 + a[8]*b2  + a[12]*b3;
    o[c*4+1] = a[1]*b0 + a[5]*b1 + a[9]*b2  + a[13]*b3;
    o[c*4+2] = a[2]*b0 + a[6]*b1 + a[10]*b2 + a[14]*b3;
    o[c*4+3] = a[3]*b0 + a[7]*b1 + a[11]*b2 + a[15]*b3;
  }
  return o;
}
/* o = V · T(x,y,z) — cheap model-view for translation-only models */
export function mulT(o, v, x, y, z){
  o.set(v);
  o[12] = v[0]*x + v[4]*y + v[8]*z  + v[12];
  o[13] = v[1]*x + v[5]*y + v[9]*z  + v[13];
  o[14] = v[2]*x + v[6]*y + v[10]*z + v[14];
  return o;
}
/* view = Rx(−pitch)·Ry(yaw)·T(−eye) */
export function viewMatrix(o, ex, ey, ez, yaw, pitch){
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  // rotation part R = Rx(−pitch)·Ry(yaw)
  o[0]=cy;      o[4]=0;   o[8]=sy;       // row 1
  o[1]=-sy*sp;  o[5]=cp;  o[9]=cy*sp;    // row 2
  o[2]=-sy*cp;  o[6]=-sp; o[10]=cy*cp;   // row 3
  o[3]=0; o[7]=0; o[11]=0; o[15]=1;
  o[12]=-(o[0]*ex + o[4]*ey + o[8]*ez);
  o[13]=-(o[1]*ex + o[5]*ey + o[9]*ez);
  o[14]=-(o[2]*ex + o[6]*ey + o[10]*ez);
  return o;
}

/* frustum planes from P·V (Gribb–Hartmann), preallocated 6×4 */
const planes = new Float32Array(24);
export function extractPlanes(m){
  const row = (i)=>[m[i], m[4+i], m[8+i], m[12+i]];
  const r0=row(0), r1=row(1), r2=row(2), r3=row(3);
  const put=(k, a,b)=>{ planes[k*4]=a[0]+b[0]; planes[k*4+1]=a[1]+b[1]; planes[k*4+2]=a[2]+b[2]; planes[k*4+3]=a[3]+b[3]; };
  const putn=(k, a,b)=>{ planes[k*4]=a[0]-b[0]; planes[k*4+1]=a[1]-b[1]; planes[k*4+2]=a[2]-b[2]; planes[k*4+3]=a[3]-b[3]; };
  put(0, r3, r0); putn(1, r3, r0);   // left, right
  put(2, r3, r1); putn(3, r3, r1);   // bottom, top
  put(4, r3, r2); putn(5, r3, r2);   // near, far
}
export function boxVisible(cx, cy, cz, hx, hy, hz){
  for (let k=0; k<6; k++){
    const a=planes[k*4], b=planes[k*4+1], c=planes[k*4+2], dd=planes[k*4+3];
    if (a*cx + b*cy + c*cz + dd < -(Math.abs(a)*hx + Math.abs(b)*hy + Math.abs(c)*hz)) return false;
  }
  return true;
}

