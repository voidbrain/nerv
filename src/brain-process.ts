import {dispatchRpc,MAX_FRAME_BYTES,RpcFault} from './rpc.ts';
// Isolated execution boundary only. No model provider, agent loop, browser, shell or tool execution yet.
process.on('message',(value:unknown)=>{
 if(Buffer.byteLength(JSON.stringify(value))>MAX_FRAME_BYTES)return;
 void dispatchRpc(value,method=>{if(method!=='runtime.ping')throw new RpcFault(-32601,'Method not found.');return {role:'brain',pid:process.pid,providers:'not configured',agentLoop:'not implemented'};}).then(reply=>{if(reply&&process.connected)process.send?.(reply);});
});
function stop(){if(process.connected)process.disconnect();}
process.on('disconnect',()=>{process.exitCode=0;});process.once('SIGTERM',stop);process.once('SIGINT',stop);
