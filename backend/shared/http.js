function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(payload));}
function failure(status,message){const e=new Error(message);e.status=status;throw e;}
async function readJson(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>5_000_000)failure(413,'Pedido demasiado grande.');}try{return JSON.parse(raw||'{}')}catch{failure(400,'JSON inválido.')}}
function qty(v,allowZero=false){if(!Number.isSafeInteger(v)||v<0||(!allowZero&&v===0))failure(422,'A quantidade deve ser um inteiro positivo.');return v;}
function day(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)failure(422,'Data inválida (AAAA-MM-DD).');return s;}
module.exports={send,failure,readJson,qty,day};
