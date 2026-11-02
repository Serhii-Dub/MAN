import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const EDGES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0;};
const wrapDeg=a=>((a+180)%360+360)%360-180;
const expo=(v,dz,range)=>{const m=Math.abs(v);if(m<=dz)return 0;return Math.sign(v)*Math.pow(clamp((m-dz)/(range-dz),0,1),1.5);};

export class HandController {
  constructor({video,canvas,onPose,onStatus,onCalibration}) {
    this.video=video;this.canvas=canvas;this.onPose=onPose||(()=>{});this.onStatus=onStatus||(()=>{});this.onCalibration=onCalibration||(()=>{});
    this.detector=null;this.stream=null;this.enabled=false;this.startPromise=null;this.startEpoch=0;this.timer=0;
    this.calibration=null;this.calibrated=false;this.center={x:.5,y:.5,theta:0};this.filters={x:[],y:[],theta:[],pinch:[]};
    this.lastVideoTime=-1;this.lastInfer=0;this.lastSeen=0;this.lostSent=false;
    this.inferenceInterval=105;this.pinchMin=.25;this.pinchMax=1.0;
  }
  start() {
    if(this.enabled)return Promise.resolve();
    if(this.startPromise)return this.startPromise;
    const task=this.startInner();
    this.startPromise=task.finally(()=>{this.startPromise=null;});
    return this.startPromise;
  }
  async startInner() {
    const epoch=++this.startEpoch;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Камера доступна через HTTPS або localhost.");
    this.onStatus("Запит дозволу камери…");
    try {
      this.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:"user",width:{ideal:320,max:640},height:{ideal:240,max:480},frameRate:{ideal:15,max:15}}});
      if(epoch!==this.startEpoch){this.stream.getTracks().forEach(t=>t.stop());return;}
      this.video.srcObject=this.stream;await this.video.play();
      this.onStatus("Завантаження моделі руки…");
      const vision=await FilesetResolver.forVisionTasks(WASM_URL);
      const options={baseOptions:{modelAssetPath:MODEL_URL,delegate:"GPU"},runningMode:"VIDEO",numHands:1,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5};
      try{this.detector=await HandLandmarker.createFromOptions(vision,options);}
      catch(e){options.baseOptions.delegate="CPU";this.detector=await HandLandmarker.createFromOptions(vision,options);}
      if(epoch!==this.startEpoch){this.detector.close();this.detector=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;return;}
      this.enabled=true;this.lastVideoTime=-1;this.lastInfer=0;this.lastSeen=performance.now();this.lostSent=false;
      this.startCalibration();this.onStatus("Камера готова · долоню в центр на 2 с");this.loop();
    } catch(error) {
      if(epoch===this.startEpoch){this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;this.detector?.close();this.detector=null;this.enabled=false;}
      throw error;
    }
  }
  stop() {
    this.startEpoch++;this.enabled=false;clearTimeout(this.timer);this.timer=0;
    this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;
    this.detector?.close();this.detector=null;this.calibration=null;this.calibrated=false;
    this.filters={x:[],y:[],theta:[],pinch:[]};
    const ctx=this.canvas.getContext("2d");ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    this.onPose({hand:false,stopped:true});this.onStatus("Камеру вимкнено.");
  }
  startCalibration() {
    if(!this.enabled&& !this.detector)return;
    this.calibration={started:performance.now(),samples:[]};this.calibrated=false;
    this.onCalibration({seconds:0,done:false,label:"Тримайте долоню по центру"});
  }
  loop() {
    if(!this.enabled||!this.detector)return;
    const now=performance.now();
    if(this.video.readyState>=2&&now-this.lastInfer>=this.inferenceInterval&&this.video.currentTime!==this.lastVideoTime){
      this.lastInfer=now;this.lastVideoTime=this.video.currentTime;
      try{
        const result=this.detector.detectForVideo(this.video,now),lm=result.landmarks?.[0];
        if(lm){this.lastSeen=now;this.lostSent=false;const raw=this.features(lm);this.pushFilter(raw);const p=this.filtered();this.draw(lm);this.calibrationSample(p,now);this.onPose({...p,hand:true,gesture:this.gesture(lm),landmarks:lm,at:now});}
        else {this.draw(null);if(now-this.lastSeen>500&&!this.lostSent){this.lostSent=true;this.onPose({hand:false,failsafe:true,at:now});}}
      }catch(error){this.onStatus("Помилка трекінгу руки: "+error.message);}
    }
    this.timer=setTimeout(()=>this.loop(),30);
  }
  features(lm) {
    const wrist=lm[0],mid=lm[9],S=Math.max(.001,dist(wrist,mid));
    const x=1-mid.x,y=mid.y,theta=Math.atan2((1-mid.x)-(1-wrist.x),-(mid.y-wrist.y))*180/Math.PI;
    return {x,y,theta,pinch:dist(lm[4],lm[8])/S};
  }
  pushFilter(p){for(const k of ["x","y","theta","pinch"]){const q=this.filters[k];q.push(p[k]);if(q.length>3)q.shift();}}
  filtered() {
    const x=mean(this.filters.x),y=mean(this.filters.y),theta=mean(this.filters.theta),pinch=mean(this.filters.pinch);
    const dx=this.calibrated?x-this.center.x:0,dy=this.calibrated?this.center.y-y:0,dt=this.calibrated?wrapDeg(theta-this.center.theta):0;
    const open=clamp((pinch-this.pinchMin)/(this.pinchMax-this.pinchMin),0,1);
    return {x,y,theta,pinch,roll:expo(dx,.07,.34),pitch:expo(dy,.07,.34),yaw:expo(dt,8,42),open,throttle:open};
  }
  calibrationSample(p,now) {
    if(!this.calibration)return;
    const elapsed=now-this.calibration.started;
    this.calibration.samples.push({x:p.x,y:p.y,theta:p.theta});
    this.onCalibration({seconds:Math.min(2,elapsed/1000),done:false,label:"Тримайте долоню по центру"});
    if(elapsed<1800)return;
    if(this.calibration.samples.length<5){this.calibration=null;this.onCalibration({error:"Не вдалося побачити руку. Поставте долоню перед камерою й повторіть."});return;}
    this.center={x:median(this.calibration.samples.map(v=>v.x)),y:median(this.calibration.samples.map(v=>v.y)),theta:median(this.calibration.samples.map(v=>v.theta))};
    this.calibration=null;this.calibrated=true;this.onCalibration({done:true});this.onStatus("Готово · рухайте долоню як джойстик");
  }
  gesture(lm) {
    const ext=[[8,6],[12,10],[16,14],[20,18]].map(([tip,pip])=>dist(lm[tip],lm[0])>dist(lm[pip],lm[0])*1.08);
    if(!ext.some(Boolean))return "fist";
    if(ext[0]&&ext[1]&&!ext[2]&&!ext[3])return "v";
    if(ext.every(Boolean))return "open";
    return "other";
  }
  draw(lm) {
    const c=this.canvas,ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);if(!lm)return;
    ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=3;ctx.strokeStyle="#70efc2";
    for(const [a,b] of EDGES){ctx.beginPath();ctx.moveTo((1-lm[a].x)*c.width,lm[a].y*c.height);ctx.lineTo((1-lm[b].x)*c.width,lm[b].y*c.height);ctx.stroke();}
    ctx.fillStyle="#ffb44a";for(const i of [0,4,8,9,17]){ctx.beginPath();ctx.arc((1-lm[i].x)*c.width,lm[i].y*c.height,3.5,0,Math.PI*2);ctx.fill();}
  }
}
