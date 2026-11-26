let loading;
export function loadDetector() {
  if (!loading) loading = new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='/ocr/opencv.js';
    script.onerror=()=>reject(new Error('OpenCV no disponible'));
    script.onload=async()=>{
      try {
        const cv=window.cv;
        if (cv.Mat) resolve({cv});
        else if (cv instanceof Promise) resolve({cv:await cv});
        else cv.onRuntimeInitialized=()=>resolve({cv});
      } catch(e){reject(e);}
    };
    document.head.append(script);
  }).catch(e=>{loading=null;throw e;});
  return loading;
}

const distance=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);
function ordered(points) {
  const cx=points.reduce((s,p)=>s+p.x,0)/4, cy=points.reduce((s,p)=>s+p.y,0)/4;
  points.sort((p,q)=>Math.atan2(p.y-cy,p.x-cx)-Math.atan2(q.y-cy,q.x-cx));
  const lengths=points.map((p,i)=>distance(p,points[(i+1)%4]));
  let i=lengths[0]+lengths[2]<=lengths[1]+lengths[3]?0:1;
  if(points[i].y+points[(i+1)%4].y>points[(i+2)%4].y+points[(i+3)%4].y) i+=2;
  return [0,1,2,3].map(j=>points[(i+j)%4]);
}

export function locate(cv,source) {
  const w=source.videoWidth||source.naturalWidth||source.width,h=source.videoHeight||source.naturalHeight||source.height;
  const preview=document.createElement('canvas'),scale=Math.min(1,600/Math.max(w,h));
  preview.width=Math.round(w*scale);preview.height=Math.round(h*scale);
  preview.getContext('2d').drawImage(source,0,0,preview.width,preview.height);
  const rgba=cv.imread(preview), gray=new cv.Mat(), binary=new cv.Mat(), kernel=cv.Mat.ones(3,3,cv.CV_8U);
  let best=null, score=0;
  try {
    cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,gray,new cv.Size(3,3),0);
    for(const level of [0,85,155]){
      if(level) cv.threshold(gray,binary,level,255,cv.THRESH_BINARY);
      else {cv.Canny(gray,binary,32,98);cv.morphologyEx(binary,binary,cv.MORPH_CLOSE,kernel);}
      const curves=new cv.MatVector(), hierarchy=new cv.Mat();
      try {
        cv.findContours(binary,curves,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
        for(let i=0;i<curves.size();i++){
          const curve=curves.get(i),poly=new cv.Mat();
          try {
            const area=cv.contourArea(curve)/(preview.width*preview.height);
            if(area<.018 || area>.985)continue;
            cv.approxPolyDP(curve,poly,.025*cv.arcLength(curve,true),true);
            if(poly.rows!==4 || !cv.isContourConvex(poly))continue;
            const pts=ordered(Array.from({length:4},(_,k)=>({x:poly.data32S[2*k],y:poly.data32S[2*k+1]})));
            const lens=pts.map((p,k)=>distance(p,pts[(k+1)%4]));
            const ratio=(lens[0]+lens[2])/(lens[1]+lens[3]);
            if(ratio<.47 || ratio>.89 || Math.min(...lens)<18)continue;
            const next=area*Math.exp(-2*Math.abs(Math.log(ratio/(63/88))));
            if(next>score){score=next;best=pts.map(p=>({x:p.x/preview.width,y:p.y/preview.height}));}
          } finally {poly.delete();curve.delete();}
        }
      } finally {curves.delete();hierarchy.delete();}
    }
  } finally {rgba.delete();gray.delete();binary.delete();kernel.delete();}
  return best;
}

export function rectify(cv,source,quad) {
  const w=source.videoWidth||source.naturalWidth||source.width,h=source.videoHeight||source.naturalHeight||source.height;
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  canvas.getContext('2d').drawImage(source,0,0,w,h);
  const frame=cv.imread(canvas),dst=new cv.Mat();
  const srcPts=cv.matFromArray(4,1,cv.CV_32FC2,quad.flatMap(p=>[p.x*w,p.y*h]));
  const dstPts=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,629,0,629,879,0,879]);
  const matrix=cv.getPerspectiveTransform(srcPts,dstPts);
  try {cv.warpPerspective(frame,dst,matrix,new cv.Size(630,880));cv.imshow(canvas,dst);return canvas;}
  finally {matrix.delete();dstPts.delete();srcPts.delete();dst.delete();frame.delete();}
}
