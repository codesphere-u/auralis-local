import { Ollama } from '../server/provider.ts';
import { configFromEnv } from '../server/config.ts';
const config=configFromEnv();const provider=new Ollama(config.ollama);
const models=process.argv.slice(2);if(!models.length)models.push(config.model);
const prompt='Explain why the sky appears blue in exactly two concise sentences.';
for(const model of models) {
  if(!(await provider.models()).includes(model))throw new Error(`${model} is not installed; benchmark never downloads models.`);
  for(let trial=1;trial<=3;trial++) {
    const start=performance.now();let first:number|undefined;let count=0;let duration=0;let chars=0;
    for await(const p of provider.chat(model,[{role:'user',content:prompt}],2048,false,AbortSignal.timeout(180000))) {
      if(p.message?.content){first??=performance.now();chars+=p.message.content.length;}
      if(p.done){count=p.eval_count||0;duration=p.eval_duration||0;}
    }
    console.log(JSON.stringify({model,trial,context:2048,ttftMs:first?Math.round(first-start):null,totalMs:Math.round(performance.now()-start),outputTokens:count,tokensPerSecond:duration?+(count/(duration/1e9)).toFixed(1):null,chars}));
  }
}
