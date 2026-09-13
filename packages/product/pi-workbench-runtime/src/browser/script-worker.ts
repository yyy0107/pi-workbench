export const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
let sequence = 0;
const pending = new Map();
parentPort.on('message', message => {
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  message.error ? request.reject(new Error(message.error)) : request.resolve(message.value);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  parentPort.postMessage({type:'cdp',id,method,params});
});
const resultOf = async promise => {
  try { return {success:true,data:await promise}; }
  catch(error) { return {success:false,error:{message:error.message}}; }
};
const daemon = {
  session: () => ({call:(method,params) => resultOf(call(method,params))}),
  evaluateJs: expression => resultOf(call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}).then(result => {
    if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  })),
};
const onUpdate = value => parentPort.postMessage({type:'update',value});
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
Promise.resolve().then(() => new AsyncFunction('params','daemon','require','signal','onUpdate','ctx',workerData.source)(
  workerData.params,daemon,createRequire(workerData.requireFrom),new AbortController().signal,onUpdate,{cwd:workerData.cwd}
)).then(value => parentPort.postMessage({type:'result',value}),error => parentPort.postMessage({type:'error',error:String(error.stack || error)}));
`;
