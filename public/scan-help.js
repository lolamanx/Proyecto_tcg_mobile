const memoriesKey = 'cardfolio.scan-examples.v1';
function examples() {
  try { return JSON.parse(localStorage.getItem(memoriesKey) || '[]'); } catch { return []; }
}

export function captureExample(source) {
  const canvas = document.createElement('canvas');
  canvas.width = 144;
  canvas.height = 200;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  ctx.drawImage(source,0,0,144,200);
  const pixels = ctx.getImageData(0,0,144,200).data;
  const key = [];
  for (let y=24; y<96; y+=8) for (let x=16; x<132; x+=8) {
    const i=(y*144+x)*4;
    key.push(Math.round((pixels[i]+2*pixels[i+1]+pixels[i+2])/32));
  }
  return {pixels,key};
}

export function remember(scan,card,source) {
  if (!scan) return;
  const rows = examples().filter(row => row.source !== source || row.card.id !== card.id);
  try { localStorage.setItem(memoriesKey, JSON.stringify([{source,card,key:scan.key},...rows].slice(0,120))); } catch {}
}

export function suggestions(scan,catalog,text,source) {
  const hits = [];
  for (const row of examples()) {
    if (row.source !== source || row.key.length !== scan.key.length) continue;
    const distance = scan.key.reduce((n,v,i)=>n+Math.abs(v-row.key[i]),0)/scan.key.length;
    if (distance < 2.8) hits.push({card:row.card,score:.84-distance*.08,signals:['ejemplo confirmado']});
  }
  const words = text.toLowerCase().match(/[a-záéíóúñ]{3,}/g) || [];
  const fragments = words.flatMap(w=>Array.from({length:w.length-2},(_,i)=>w.slice(i,i+3)));
  if (fragments.length) {
    const scored = new Map();
    for (const card of catalog.cards) {
      if (!scored.has(card.name)) {
        const name = card.name.toLowerCase();
        const parts = Array.from({length:Math.max(0,name.length-2)},(_,i)=>name.slice(i,i+3));
        const matches = parts.filter(p=>fragments.includes(p)).length;
        scored.set(card.name,matches>=2 ? matches/parts.length : 0);
      }
      const similarity = scored.get(card.name);
      if(similarity>=.38) hits.push({card,score:.24+.25*similarity,signals:['nombre parcial']});
    }
  }
  const seen=new Set();
  return hits.sort((a,b)=>b.score-a.score).filter(x=>!seen.has(x.card.id)&&seen.add(x.card.id)).slice(0,5);
}

export function exclusive(card) {
  if (card.exclusiveLanguage === 'ja') return 'ja';
  return (card.setId === 'fut20' || /futsal/i.test(card.setName)) && /on the Ball$/i.test(card.name) ? 'en' : '';
}

const mask = '0000000000000000001100000001100000101111111001000010001000001100000100000001111000001100001100100000100000000010000010000000010000001000000001000000110000001100000001000111000000000011100000000000000000000000';
export function stampHint(scan,card) {
  if (!scan) return '';
  const pixels=scan.pixels;
  if (/pok.mon go/i.test(card.setName) && ['6','13','59'].includes(String(Number(card.number)))) {
    let purple=0;
    for(let y=178;y<195;y++) for(let x=7;x<40;x++) {
      const i=(y*144+x)*4;
      if(pixels[i]>pixels[i+1]+18 && pixels[i+2]>pixels[i+1]+22) purple++;
    }
    if(purple>=5 && purple<=100) return 'Ditto';
  }
  // Match the bright outline against the normalized seal region of the sample.
  for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++){
    let intersection=0,union=0;
    for(let y=0;y<13;y++) for(let x=0;x<16;x++){
      const i=((156+y+dy)*144+123+x+dx)*4;
      const bright=Math.min(pixels[i],pixels[i+1],pixels[i+2])>188;
      const expected=mask[y*16+x] === '1';
      if(bright && expected) intersection++;
      if(bright || expected) union++;
    }
    if(intersection/union>.61) return 'Eevee';
  }
  return '';
}
