const normalize=s=>(s||"").toLocaleLowerCase("uk-UA").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();

export class VoiceController {
  constructor({onText,onStatus}) {
    this.onText=onText||(()=>{});
    this.onStatus=onStatus||(()=>{});
    this.recognition=null;
    this.enabled=false;
    const C=window.SpeechRecognition||window.webkitSpeechRecognition;
    this.supported=!!C;
    if(!C) return;
    this.recognition=new C();
    this.recognition.lang="uk-UA";
    this.recognition.continuous=true;
    this.recognition.interimResults=false;
    this.recognition.maxAlternatives=1;
    this.recognition.onresult=e=>{
      for(let i=e.resultIndex;i<e.results.length;i++) {
        if(!e.results[i].isFinal) continue;
        const text=e.results[i][0].transcript||"";
        this.onText(text,normalize(text));
      }
    };
    this.recognition.onerror=e=>{
      this.onStatus("Мікрофон: "+e.error);
      if(e.error==="not-allowed"||e.error==="service-not-allowed") this.enabled=false;
    };
    this.recognition.onend=()=>{
      if(this.enabled) setTimeout(()=>{if(this.enabled) this.safeStart();},450);
      else this.onStatus("Голос вимкнено.");
    };
  }
  safeStart() {
    try { this.recognition.start(); this.onStatus("Слухаю українські команди…"); }
    catch(e) { if(e.name!=="InvalidStateError") this.onStatus("Мікрофон: "+e.message); }
  }
  enable() {
    if(!this.supported){this.onStatus("У цьому браузері немає SpeechRecognition. Використайте кнопки або клавіші.");return false;}
    if(this.enabled) return true;
    this.enabled=true; this.safeStart(); return true;
  }
  disable() {
    this.enabled=false;
    if(this.recognition){try{this.recognition.stop();}catch(e){}}
    this.onStatus("Голос вимкнено.");
  }
}
export {normalize};
