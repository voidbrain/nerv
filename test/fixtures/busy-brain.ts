process.on('message',(value:unknown)=>{
 const request=value as {id:string};const start=Date.now();while(Date.now()-start<3500){/* Deliberately block this isolated process only. */}
 process.send?.({jsonrpc:'2.0',id:request.id,result:{env:Object.keys(process.env)}});
});
process.on('disconnect',()=>{process.exitCode=0;});
process.send?.({nerv:'ready'});
