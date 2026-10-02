const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function openDemo(Recognition) {
  const handlers={};
  const app={innerHTML:''};
  const transcriptField={value:''};
  const useButton={disabled:true};
  const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};
  const storage={value:JSON.stringify({onboardingComplete:true,profile,meals:[],messages:[],view:'chat'})};
  const window={location:{protocol:'file:',search:''},addEventListener(){}};
  if (Recognition) window.SpeechRecognition=Recognition;
  const document={
    getElementById(id) {
      if (id==='app') return app;
      if (id==='photo-input') return {addEventListener(){}};
      if (id==='voice-transcript') return transcriptField;
      if (id==='message-input') return {focus(){}};
      return null;
    },
    querySelector(selector) {return selector==='[data-action="voice-use"]'?useButton:null;},
    addEventListener(name,handler) {handlers[name]=handler;},
  };
  const context={window,document,URLSearchParams,localStorage:{getItem(){return storage.value;},setItem(_key,value){storage.value=value;}},requestAnimationFrame(callback){callback();},setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},console};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(`${__dirname}/nutrition.js`,'utf8'),context);
  vm.runInContext(fs.readFileSync(`${__dirname}/app.js`,'utf8'),context);
  const click=action=>handlers.click({target:{closest(){return {dataset:{action}};}}});
  return {app,click,handlers,transcriptField,storage};
}

test('unsupported browser explains why voice cannot start and offers text input', () => {
  const demo=openDemo();
  demo.click('voice-demo');
  assert.match(demo.app.innerHTML,/当前浏览器不支持语音识别/);
  assert.match(demo.app.innerHTML,/改用文字输入/);
  assert.doesNotMatch(demo.app.innerHTML,/插入示例口述/);
});

test('manual stop leaves recognized words available for review', () => {
  let recognition;
  class Recognition {
    constructor() {recognition=this;}
    start() {this.onstart();}
    stop() {this.onend();}
    abort() {}
  }
  const demo=openDemo(Recognition);
  demo.click('voice-demo');
  recognition.onresult({results:[[{transcript:'刚吃了两个鸡蛋'}]]});
  demo.click('voice-toggle');
  assert.match(demo.app.innerHTML,/刚吃了两个鸡蛋/);
  assert.deepEqual(JSON.parse(demo.storage.value).messages,[]);
  demo.click('voice-use');
  assert.match(demo.app.innerHTML,/刚吃了两个鸡蛋/);
  assert.deepEqual(JSON.parse(demo.storage.value).messages,[]);
});

test('natural speech end sends the recognized meal without another step', () => {
  let recognition;
  class Recognition {
    constructor() {recognition=this;}
    start() {this.onstart();}
    stop() {this.onend();}
    abort() {}
  }
  const demo=openDemo(Recognition);
  demo.click('voice-demo');
  recognition.onresult({results:[[{transcript:'刚吃了两个鸡蛋'}]]});
  recognition.onend();
  const saved=JSON.parse(demo.storage.value);
  assert.equal(saved.messages[0].text,'刚吃了两个鸡蛋');
  assert.equal(saved.meals.length,1);
});
