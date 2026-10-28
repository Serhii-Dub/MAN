import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const EDGES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
const median = a => { const b=[...a].sort((x,y)=>x-y); return b.length ? b[Math.floor(b.length/2)] : 0; };
const wrapDeg = a => ((a+180)%360+360)%360-180;
const expo = (v,dz,range) => {
  const m=Math.abs(v);
  if(m<=dz) return 0;
  const n=clamp((m-dz)/(range-dz),0,1);
  return Math.sign(v)*Math.pow(n,1.5);
};

export class HandController {
  constructor(options) {
    this.video=options.video;
    this.canvas=options.canvas;
    this.onPose=options.onPose||(()=>{});
    this.onStatus=options.onStatus||(()=>{});
    this.onCalibration=options.onCalibration||(()=>{});
    this.detector=null;
    this.stream=null;
    this.raf=0;
    this.lastVideoTime=-1;
    this.lastInfer=0;
    this.enabled=false;
    this.calibration=null;
    this.calibrated=false;
    this.lostSent=false;
    this.filters={x:[],y:[],theta:[],pinch:[]};
    this.center={x:0.5,y:0.5,theta:0};
    this.pinchMin=0.18;
    this.pinchMax=1.0;
    this.pinchNeutral=0.6;
    this.p0=0.5;
    this.lastSeen=0;
  }
  async start() {
    if(this.enabled) return;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("Камера доступна лише через HTTPS або localhost.");
    this.onStatus("Запит дозволу камери…");
    this.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:"user",width:{ideal:640},height:{ideal:480}}});
    this.video.srcObject=this.stream;
    await this.video.play();
    this.enabled=true;
    this.onStatus("Завантаження MediaPipe…");
    const vision=await FilesetResolver.forVisionTasks(WASM_URL);
    const opts={baseOptions:{modelAssetPath:MODEL_URL,delegate:"GPU"},runningMode:"VIDEO",numHands:1,minHandDetectionConfidence:0.55,minHandPresenceConfidence:0.55,minTrackingConfidence:0.55};
    try { this.detector=await HandLandmarker.createFromOptions(vision,opts); }
    catch(e) {
      opts.baseOptions.delegate="CPU";
      this.detector=await HandLandmarker.createFromOptions(vision,opts);
    }
    this.onStatus("Камера готова. Покажіть долоню.");
    this.loop();
  }
  stop() {
    this.enabled=false;
    cancelAnimationFrame(this.raf);
    if(this.stream) this.stream.getTracks().forEach(t=>t.stop());
    this.stream=null;
    this.video.srcObject=null;
    if(this.detector){this.detector.close();this.detector=null;}
    this.calibration=null;
    this.filters={x:[],y:[],theta:[],pinch:[]};
    this.onPose({hand:false,stopped:true});
    this.onStatus("Камеру вимкнено.");
  }
  startCalibration() {
    if(!this.enabled) throw new Error("Спочатку увімкніть камеру.");
    this.calibration={started:performance.now(),samples:[[],[],[]],lastStage:-1};
    this.calibrated=false;
    this.onCalibration({stage:0,seconds:0,done:false});
    this.onStatus("Калібрування: долоня нейтрально, щіпка напіввідкрита.");
  }
  loop() {
    if(!this.enabled) return;
    const now=performance.now();
    if(this.video.readyState>=2 && now-this.lastInfer>65 && this.video.currentTime!==this.lastVideoTime) {
      this.lastInfer=now;
      this.lastVideoTime=this.video.currentTime;
      try {
        const result=this.detector.detectForVideo(this.video,now);
        const lm=result.landmarks && result.landmarks[0];
        if(lm) {
          this.lastSeen=now;
          this.lostSent=false;
          const p=this.features(lm);
          this.pushFilter(p);
          const filtered=this.filtered(p);
          this.draw(lm);
          this.calibrationSample(filtered,now);
          this.onPose({...filtered,hand:true,gesture:this.gesture(lm),landmarks:lm,at:now});
        } else {
          this.draw(null);
          if(now-this.lastSeen>500 && !this.lostSent) {
            this.lostSent=true;
            this.onPose({hand:false,failsafe:true,at:now});
          }
        }
      } catch(e) {
        this.onStatus("Помилка відстеження: "+e.message);
      }
    }
    this.raf=requestAnimationFrame(()=>this.loop());
  }
  features(lm) {
    const wrist=lm[0], mid=lm[9];
    const x=1-mid.x, y=mid.y;
    const theta=Math.atan2((1-mid.x)-(1-wrist.x),-(mid.y-wrist.y))*180/Math.PI;
    const S=Math.max(0.001,dist(wrist,mid));
    const pinch=dist(lm[4],lm[8])/S;
    return {x,y,theta,pinch};
  }
  pushFilter(p) {
    for(const k of ["x","y","theta","pinch"]) {
      const q=this.filters[k];
      q.push(p[k]); if(q.length>5) q.shift();
    }
  }
  filtered(p) {
    const x=mean(this.filters.x), y=mean(this.filters.y), theta=mean(this.filters.theta), pinch=mean(this.filters.pinch);
    let roll=0,pitch=0,yaw=0,throttle=0,open=0;
    if(this.calibrated) {
      roll=expo(x-this.center.x,0.08,0.38);
      pitch=expo(this.center.y-y,0.08,0.38);
      yaw=expo(wrapDeg(theta-this.center.theta),7,38);
      open=clamp((pinch-this.pinchMin)/(this.pinchMax-this.pinchMin),0,1);
      const d=open-this.p0;
      throttle=expo(d,0.05,Math.max(this.p0,1-this.p0));
    }
    return {x,y,theta,pinch,roll,pitch,yaw,open,throttle};
  }
  calibrationSample(p,now) {
    if(!this.calibration) return;
    const elapsed=now-this.calibration.started;
    const stage=Math.min(2,Math.floor(elapsed/2000));
    if(stage!==this.calibration.lastStage) {
      this.calibration.lastStage=stage;
      const labels=["Долоня нейтрально, щіпка напіввідкрита","Зведіть кінчики великого та вказівного пальців","Розведіть пальці комфортно"];
      this.onCalibration({stage,seconds:0,done:false,label:labels[stage]});
      this.onStatus("Калібрування: "+labels[stage]+".");
    }
    this.calibration.samples[stage].push(p);
    this.onCalibration({stage,seconds:Math.min(2,(elapsed-stage*2000)/1000),done:false});
    if(elapsed<6000) return;
    const s=this.calibration.samples;
    if(s.some(a=>a.length<6)) {
      this.calibration=null;
      this.onCalibration({done:false,error:"Руку було втрачено під час калібрування. Спробуйте ще раз."});
      this.onStatus("Калібрування не завершилось. Спробуйте ще раз.");
      return;
    }
    this.center={x:mean(s[0].map(v=>v.x)),y:mean(s[0].map(v=>v.y)),theta:mean(s[0].map(v=>v.theta))};
    this.pinchNeutral=median(s[0].map(v=>v.pinch));
    this.pinchMin=median(s[1].map(v=>v.pinch));
    this.pinchMax=median(s[2].map(v=>v.pinch));
    if(this.pinchMax<this.pinchMin){const t=this.pinchMin;this.pinchMin=this.pinchMax;this.pinchMax=t;}
    if(this.pinchMax-this.pinchMin<0.18) {
      this.calibration=null;
      this.onCalibration({done:false,error:"Щіпка змінилася замало. Розведіть пальці ширше й повторіть."});
      this.onStatus("Калібрування щіпки не вдалося.");
      return;
    }
    this.p0=clamp((this.pinchNeutral-this.pinchMin)/(this.pinchMax-this.pinchMin),0.2,0.8);
    this.calibrated=true;
    this.calibration=null;
    this.onCalibration({done:true,center:this.center,p0:this.p0});
    this.onStatus("Калібрування завершено.");
  }
  gesture(lm) {
    const ext=[[8,6],[12,10],[16,14],[20,18]].map(pair=>dist(lm[pair[0]],lm[0])>dist(lm[pair[1]],lm[0])*1.08);
    if(!ext.some(Boolean)) return "fist";
    if(ext[0]&&ext[1]&&!ext[2]&&!ext[3]) return "v";
    if(ext.every(Boolean)) return "open";
    return "other";
  }
  draw(lm) {
    const c=this.canvas,ctx=c.getContext("2d");
    ctx.clearRect(0,0,c.width,c.height);
    if(!lm) return;
    ctx.lineCap="round"; ctx.lineJoin="round"; ctx.lineWidth=4; ctx.strokeStyle="rgba(112,247,197,.9)";
    for(const [a,b] of EDGES) {
      ctx.beginPath(); ctx.moveTo((1-lm[a].x)*c.width,lm[a].y*c.height); ctx.lineTo((1-lm[b].x)*c.width,lm[b].y*c.height); ctx.stroke();
    }
    ctx.fillStyle="#ffb44a";
    for(const i of [0,4,8,9,17]) {ctx.beginPath();ctx.arc((1-lm[i].x)*c.width,lm[i].y*c.height,5,0,Math.PI*2);ctx.fill();}
  }
}
