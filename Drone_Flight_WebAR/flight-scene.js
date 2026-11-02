import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.173.0/build/three.module.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class FlightScene3D {
  constructor({canvas,wrap,pipCanvas,state,heightAt}) {
    this.canvas=canvas;this.wrap=wrap;this.pipCanvas=pipCanvas;this.state=state;this.heightAt=heightAt;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x91bfd0);this.scene.fog=new THREE.Fog(0x91bfd0,260,1500);
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,depth:true,stencil:false,powerPreference:"low-power"});
    this.renderer.setPixelRatio(1);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.setClearColor(0x91bfd0,1);this.renderer.shadowMap.enabled=false;
    this.fpv=new THREE.PerspectiveCamera(76,1,.1,1800);this.chase=new THREE.PerspectiveCamera(66,1,.1,1800);
    this.scene.add(new THREE.HemisphereLight(0xe4f1ff,0x59604b,2.0));const sun=new THREE.DirectionalLight(0xffe0a8,2.25);sun.position.set(-180,260,180);this.scene.add(sun);
    this.makeGround();this.makeForest();this.makeTrainingSite();this.makeDrone();this.makeGate();this.makeOrbitTarget();
    this.resize();
  }
  mat(color,roughness=1,metalness=0,emissive=0){return new THREE.MeshStandardMaterial({color,roughness,metalness,emissive,flatShading:true});}
  makeGround(){
    const nx=88,nz=360,xMin=-620,xMax=620,zNear=320,zFar=-10800,g=new THREE.BufferGeometry(),pos=[],col=[],idx=[];
    const grass=new THREE.Color(0x657c54),dirt=new THREE.Color(0x8e8060),gray=new THREE.Color(0x756e5b);
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
      const x=xMin+(xMax-xMin)*i/nx,z=zNear+(zFar-zNear)*j/nz,y=this.heightAt(x,z)-1.8;
      pos.push(x,y,z);const stripe=Math.abs(x)<28?dirt:Math.abs(x)<52?gray:grass;const noise=.91+.09*Math.sin(x*.11+z*.08)*Math.cos(z*.045);const c=stripe.clone().multiplyScalar(noise);col.push(c.r,c.g,c.b);
      if(i<nx&&j<nz){const a=j*(nx+1)+i,b=a+1,d=a+nx+1,e=d+1;idx.push(a,b,d,b,e,d);}
    }
    g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setAttribute("color",new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);g.computeVertexNormals();
    this.scene.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,flatShading:true})));
  }
  makeForest(){
    const trunkGeom=new THREE.CylinderGeometry(.42,.6,4.2,5),crownGeom=new THREE.ConeGeometry(3.6,9,5),trunkMat=this.mat(0x554735),crownMat=this.mat(0x385a3d);
    const spots=[];for(let row=0;row<86;row++){const z=180-row*118;for(let side of [-1,1])for(let k=0;k<5;k++){const x=side*(72+k*20+((row*13+k*7)%13));spots.push([x,z-((k*29+row*17)%54)]);}}
    const trunks=new THREE.InstancedMesh(trunkGeom,trunkMat,spots.length),crowns=new THREE.InstancedMesh(crownGeom,crownMat,spots.length),dummy=new THREE.Object3D();
    spots.forEach(([x,z],i)=>{const ground=this.heightAt(x,z);dummy.position.set(x,ground+2,z);dummy.rotation.y=(i%5)*.63;dummy.scale.setScalar(.8+(i%4)*.1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);dummy.position.y=ground+8;dummy.scale.setScalar(.83+(i%5)*.08);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);});
    trunks.instanceMatrix.needsUpdate=true;crowns.instanceMatrix.needsUpdate=true;this.scene.add(trunks,crowns);
  }
  makeTrainingSite(){
    const containerGeo=new THREE.BoxGeometry(15,5,5),containerMats=[this.mat(0x69736d),this.mat(0x455c62),this.mat(0x77745f),this.mat(0x554f42)];
    const containers=new THREE.InstancedMesh(containerGeo,this.mat(0x69736d),54),dummy=new THREE.Object3D();let n=0;
    for(let row=0;row<27;row++)for(let side of [-1,1]){const x=side*(44+(row%3)*12),z=-95-row*176;dummy.position.set(x,this.heightAt(x,z)+2.5,z);dummy.rotation.y=(row%2)*.06;dummy.scale.set(1,1,1);dummy.updateMatrix();containers.setMatrixAt(n++,dummy.matrix);containers.setColorAt(n-1,new THREE.Color([0x69736d,0x455c62,0x77745f,0x554f42][row%4]));}
    containers.instanceMatrix.needsUpdate=true;if(containers.instanceColor)containers.instanceColor.needsUpdate=true;this.scene.add(containers);
    const shedMat=this.mat(0x74766d),roofMat=this.mat(0x424b4b),doorMat=this.mat(0x242f31),shedGeo=new THREE.BoxGeometry(34,13,23),roofGeo=new THREE.BoxGeometry(36,1.4,25),doorGeo=new THREE.BoxGeometry(10,8,.35);
    for(let row=0;row<13;row++){const side=row%2?1:-1,x=side*(94+(row%3)*8),z=-220-row*330,y=this.heightAt(x,z);const group=new THREE.Group();const shed=new THREE.Mesh(shedGeo,shedMat);shed.position.y=6.5;const roof=new THREE.Mesh(roofGeo,roofMat);roof.position.y=13.7;const door=new THREE.Mesh(doorGeo,doorMat);door.position.set(0,4.1,-11.7);group.add(shed,roof,door);group.position.set(x,y,z);this.scene.add(group);}
    const tireGeo=new THREE.TorusGeometry(1.15,.32,5,10),tireMat=this.mat(0x252b29),barGeo=new THREE.BoxGeometry(7,.8,.8),barMat=this.mat(0xb96e39);
    for(let i=0;i<14;i++){const x=(i%2?1:-1)*(20+(i%4)*10),z=-55-Math.floor(i/2)*205,y=this.heightAt(x,z);const tire=new THREE.Mesh(tireGeo,tireMat);tire.position.set(x,y+1.2,z);tire.rotation.y=Math.PI/2;this.scene.add(tire);if(i%2===0){const bar=new THREE.Mesh(barGeo,barMat);bar.position.set(x,y+2,z-5);bar.rotation.y=.1;this.scene.add(bar);}}
  }
  makeDrone(){
    const group=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(1.5,.38,1.6),this.mat(0xe5a452,.72,.15)),nose=new THREE.Mesh(new THREE.BoxGeometry(.72,.25,.62),this.mat(0x253539,.55,.25));nose.position.set(0,.02,-.85);group.add(body,nose);
    const armMat=this.mat(0x243438,.55,.2),propMat=this.mat(0x52d6c2,.45,.2,.12),motorMat=this.mat(0xd78a43,.6,.1);
    for(const sx of [-1,1])for(const sz of [-1,1]){const arm=new THREE.Mesh(new THREE.BoxGeometry(2.8,.16,.2),armMat);arm.position.set(sx*.94,0,sz*.87);arm.rotation.y=sx*sz*.28;group.add(arm);const motor=new THREE.Mesh(new THREE.CylinderGeometry(.24,.24,.22,8),motorMat);motor.position.set(sx*1.9,.14,sz*1.55);group.add(motor);const prop=new THREE.Mesh(new THREE.BoxGeometry(1.45,.035,.11),propMat);prop.position.set(sx*1.9,.28,sz*1.55);group.add(prop);}
    this.drone=group;this.scene.add(group);
  }
  makeGate(){
    this.gate=new THREE.Group();const hoopMat=this.mat(0xffc15f,.34,.15,0x7a3900),innerMat=this.mat(0xfff0c7,.4,.1,0x4b2600),postMat=this.mat(0xe99b46,.6,.05),footMat=this.mat(0x303a32);
    const hoop=new THREE.Mesh(new THREE.TorusGeometry(4.65,.28,8,36),hoopMat),inner=new THREE.Mesh(new THREE.TorusGeometry(4.1,.045,5,36),innerMat);this.gate.add(hoop,inner);
    this.posts=[];this.feet=[];for(const side of [-1,1]){const post=new THREE.Mesh(new THREE.CylinderGeometry(.22,.38,1,7),postMat);post.position.x=side*5.15;this.gate.add(post);this.posts.push(post);const foot=new THREE.Mesh(new THREE.BoxGeometry(2.1,.32,2.2),footMat);foot.position.x=side*5.15;this.gate.add(foot);this.feet.push(foot);}
    const marker=new THREE.Mesh(new THREE.BoxGeometry(1.7,.65,.55),this.mat(0xffe7a0,.35,.1,0x724200));marker.position.set(0,5.35,0);this.gate.add(marker);this.scene.add(this.gate);
  }
  makeOrbitTarget(){
    this.orbitTarget=new THREE.Group();const body=this.mat(0xb7b3a4),stripe=this.mat(0xe7a852,.65,.05),dark=this.mat(0x394340),ringMat=this.mat(0x6ee0c7,.4,.05,.18);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(2.9,3.7,2,7),dark);base.position.y=1;this.orbitTarget.add(base);
    const stack=new THREE.Mesh(new THREE.CylinderGeometry(1.65,2.15,10,7),body);stack.position.y=7;this.orbitTarget.add(stack);
    for(let y of [4.5,8.5]){const band=new THREE.Mesh(new THREE.CylinderGeometry(1.78,1.78,.65,7),stripe);band.position.y=y;this.orbitTarget.add(band);}
    const ring=new THREE.Mesh(new THREE.TorusGeometry(15,.16,5,48),ringMat);ring.rotation.x=Math.PI/2;ring.position.y=.18;this.orbitTarget.add(ring);
    const arrow=new THREE.Mesh(new THREE.ConeGeometry(1,2.4,5),ringMat);arrow.rotation.x=-Math.PI/2;arrow.position.set(0,.35,-14);this.orbitTarget.add(arrow);this.scene.add(this.orbitTarget);
  }
  resize(){const w=Math.max(1,this.wrap.clientWidth),h=Math.max(1,this.wrap.clientHeight);this.renderer.setSize(w,h,false);this.fpv.aspect=w/h;this.fpv.updateProjectionMatrix();this.chase.aspect=w/h;this.chase.updateProjectionMatrix();}
  updateObjects(s){
    const gateOn=s.route==="rings";this.gate.visible=gateOn;if(gateOn){const ground=this.heightAt(s.gateX,s.gateZ),poleLength=Math.max(2,s.gateY-ground);this.gate.position.set(s.gateX,s.gateY,s.gateZ);for(const post of this.posts){post.scale.y=poleLength;post.position.y=-poleLength/2;}for(const foot of this.feet)foot.position.y=-poleLength+.16;}
    const orbitOn=s.route==="orbit";this.orbitTarget.visible=orbitOn;if(orbitOn)this.orbitTarget.position.set(s.targetX,this.heightAt(s.targetX,s.targetZ),s.targetZ);
    const y=this.heightAt(s.x,s.z)+s.altitude;this.drone.position.set(s.x,y,s.z);this.drone.rotation.order="YXZ";this.drone.rotation.set(-s.pitch*.2,s.yaw,s.roll*.38);
    const fx=Math.sin(s.yaw),fz=-Math.cos(s.yaw),lookY=y+s.pitch*18;
    this.fpv.position.set(s.x,y+.12,s.z);this.fpv.lookAt(s.x+fx*120,lookY,s.z+fz*120);this.fpv.rotateZ(s.roll*.22);
    this.chase.position.set(s.x-fx*13,y+5.5,s.z-fz*13);this.chase.lookAt(s.x+fx*9,y+.8+s.pitch*10,s.z+fz*9);
  }
  render(s,split){this.updateObjects(s);const r=this.wrap.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height);this.renderer.setScissorTest(true);this.renderer.setViewport(0,0,w,h);this.renderer.setScissor(0,0,w,h);this.renderer.clear(true,true,true);this.renderer.render(this.scene,split?this.fpv:this.chase);
    if(split){const p=this.pipCanvas.getBoundingClientRect(),x=p.left-r.left,y=r.bottom-p.bottom,pw=p.width,ph=p.height;if(pw>1&&ph>1){this.chase.aspect=pw/ph;this.chase.updateProjectionMatrix();this.renderer.setViewport(x,y,pw,ph);this.renderer.setScissor(x,y,pw,ph);this.renderer.clearDepth();this.renderer.render(this.scene,this.chase);this.chase.aspect=w/h;this.chase.updateProjectionMatrix();}}
    this.renderer.setScissorTest(false);
  }
  dispose(){this.renderer.dispose();}
}
