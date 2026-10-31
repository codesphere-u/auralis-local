import { z } from 'zod';
export type ChatMessage = {role:'system'|'user'|'assistant'|'tool';content:string;tool_name?:string;tool_calls?:ToolCall[]};
export type ToolCall = {function:{name:string;arguments:unknown}};
export const toolDefinitions = [
  {type:'function',function:{name:'calculate',description:'Evaluate a mathematical expression with + - * / % and parentheses.',parameters:{type:'object',properties:{expression:{type:'string'}},required:['expression'],additionalProperties:false}}},
  {type:'function',function:{name:'note_save',description:'Propose saving a note to local memory. Requires explicit human approval; do not claim it is saved yet.',parameters:{type:'object',properties:{title:{type:'string'},content:{type:'string'}},required:['title','content'],additionalProperties:false}}},
];
// On a 16GB Mac, an 18GB downloaded model is unsafe to load merely because
// it appears in Ollama's inventory. This is a weight-size guard, not a RAM estimate.
export const MAX_MODEL_BYTES = 8 * 1024 ** 3;
const packetSchema = z.object({
  error:z.string().optional(),done:z.boolean().optional(),eval_count:z.number().optional(),eval_duration:z.number().optional(),
  message:z.object({content:z.string().optional(),tool_calls:z.array(z.object({function:z.object({name:z.string(),arguments:z.unknown()})})).optional()}).optional(),
});
export type Packet = z.infer<typeof packetSchema>;
export async function boundedJSON(response:Response,limit=4_194_304):Promise<unknown> {
  if(!response.body) throw new Error('Empty local service response');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw new Error('Local service response too large');chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
const remoteMetadata = {remote_host:z.string().nullable().optional(),remote_model:z.string().nullable().optional()};
const isRemote = (x:{name?:string;remote_host?:string|null;remote_model?:string|null}) => !!x.remote_host || !!x.remote_model || /(?:^|[:/-])cloud(?:$|[-:/])/i.test(x.name||'') || /-cloud$/i.test(x.name||'');
export async function* parseNDJSON(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const {done,value} = await reader.read();
      buffer += decoder.decode(value,{stream:!done});
      if (buffer.length > 1_048_576) throw new Error('Provider response line too large');
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0,end).trim(); buffer = buffer.slice(end+1); if (line) yield JSON.parse(line); }
      if (done) break;
    }
    if (buffer.trim()) yield JSON.parse(buffer);
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
export class Ollama {
  constructor(public endpoint:string, private transport:typeof fetch = fetch) {}
  async models(): Promise<string[]> {
    const res = await this.transport(`${this.endpoint}/api/tags`,{signal:AbortSignal.timeout(3000),redirect:'error'});
    if (!res.ok) throw new Error('Ollama did not return a model list');
    const parsed = z.object({models:z.array(z.object({name:z.string(),size:z.number().nonnegative().optional(),...remoteMetadata})).max(1000)}).parse(await boundedJSON(res));
    return parsed.models.filter(m=>!isRemote(m) && (m.size===undefined || m.size<=MAX_MODEL_BYTES)).map(m=>m.name);
  }
  async assertLocal(model:string,signal:AbortSignal) {
    if(isRemote({name:model}) || !(await this.models()).includes(model)) throw new Error('Select an installed local model within the 8 GiB weight budget. Cloud models and remote aliases are blocked.');
    const response=await this.transport(`${this.endpoint}/api/show`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model}),redirect:'error',signal});
    if(!response.ok)throw new Error('Cannot verify local model metadata.');
    const info=z.object({...remoteMetadata,model_info:z.record(z.string(),z.unknown())}).parse(await boundedJSON(response));
    if(isRemote(info) || !Object.keys(info.model_info).length)throw new Error('Remote or unverifiable model blocked. Use downloaded local weights.');
  }
  async *chat(model:string,messages:ChatMessage[],context:number,tools:boolean,signal:AbortSignal):AsyncGenerator<Packet> {
    await this.assertLocal(model,signal);
    const res = await this.transport(`${this.endpoint}/api/chat`,{
      method:'POST',redirect:'error',signal,headers:{'content-type':'application/json'},
      body:JSON.stringify({model,messages,stream:true,think:false,keep_alive:'2m',options:{num_ctx:context,num_predict:1024,temperature:0.6},...(tools?{tools:toolDefinitions}:{})}),
    });
    if (!res.ok || !res.body) {
      if(res.status===404) throw new Error(`Model ${model} is not installed. Pull it with Ollama first.`);
      throw new Error(`Ollama request failed (${res.status}). Check that Ollama is running.`);
    }
    for await (const raw of parseNDJSON(res.body)) {
      const packet = packetSchema.parse(raw);
      if (packet.error) throw new Error('Ollama reported an inference error. Check its local logs.');
      yield packet;
    }
  }
}
