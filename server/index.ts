import { configFromEnv } from './config.ts';
import { createApp } from './app.ts';
const config=configFromEnv();
const {server}=createApp(config);
server.listen(config.port,'127.0.0.1',()=>console.log(`Auralis is ready at http://127.0.0.1:${config.port}`));
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
for(const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
