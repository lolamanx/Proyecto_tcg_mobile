// Collector codes often have a language suffix. Require a nearby collector number
// before interpreting a short token such as "EN" as a printed language.
export function printedLanguage(text) {
  if (/[ぁ-ヿ]{2,}/u.test(text)) return 'ja';
  const code = text.match(/(?:^|\s)[A-Z0-9]{2,5}[- ](EN|ES|FR|DE|IT|PT|JP|JA)\s+[0-9O]{1,3}\s*\//);
  if (code) return ({JP:'ja',JA:'ja'})[code[1]] || code[1].toLowerCase();
  const words = new Set(text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z]+/g));
  const vocabulary = {
    es:'debilidad resistencia retirada basico oponente baraja moneda danos energia',
    en:'weakness resistance retreat basic opponent discard damage shuffle flip',
    fr:'faiblesse resistance retraite base adversaire degats lancez energie',
    de:'schwache resistenz ruckzug basis gegner schaden energien munze',
    pt:'fraqueza resistencia recuo basico oponente baralho jogue danos',
    it:'debolezza resistenza ritirata base avversario danni lancia energia'
  };
  const scores = Object.entries(vocabulary).map(([lang,list])=>[lang,list.split(' ').filter(w=>words.has(w)).length]).sort((a,b)=>b[1]-a[1]);
  return scores[0][1]>=2 && scores[0][1]>scores[1][1] ? scores[0][0] : '';
}

export function bestOfBurst(video, crop, assess, consume) {
  let best, count=0;
  return () => {
    if (video.readyState < 2 || !video.videoWidth) return;
    const canvas=crop(video), quality=assess(canvas);
    const score=Math.log1p(quality.sharpness)*Math.min(1,quality.contrast/35)*(1-quality.glare);
    if (!best || score>best.score) best={canvas,quality,score};
    if (++count<3) return;
    consume(best);
    best=null;
    count=0;
  };
}
