// Geometry shared by both entrance runtimes; the settled FAB has one position.
export const FAB_LENS_SCALE = .74;
export const FAB_Y_OFFSET = -26;

export function fabTarget(width, lowerX, lowerY, baseY, sigma, movingS, weight, threshold, yOffset) {
  const runtimeWidth=width/1.1,baseX=width/2,bx=baseX-lowerX,cx=baseX+lowerX;
  const movingDen=2*movingS*movingS;
  const amplitude=px=>{
    const nearest=Math.max(bx,Math.min(cx,px));
    return (1-weight)*(Math.exp(-((px-bx)**2)/movingDen)+Math.exp(-((px-cx)**2)/movingDen))
      +weight*2*Math.exp(-((px-nearest)**2)/movingDen);
  };
  let x=(width-runtimeWidth)/2+runtimeWidth*.9;
  if(amplitude(x)<=threshold){
    let lo=baseX,hi=x;
    for(let i=0;i<18;i++){
      const mid=(lo+hi)/2;
      if(amplitude(mid)>threshold)lo=mid;else hi=mid;
    }
    x=lo;
  }
  const by=baseY+lowerY,amp=amplitude(x);
  const topY=amp>threshold?by-Math.sqrt(Math.max(0,-movingDen*Math.log(threshold/amp))):by-32;
  const liquidRadius=sigma*Math.sqrt(-2*Math.log(threshold));
  return {x,y:topY-liquidRadius+4+yOffset,liquidRadius};
}

export function settledFabSlot(width) {
  const threshold=.46,sigma=FAB_LENS_SCALE*Math.max(12,Math.min(40,width/8));
  const baseY=Math.max(72,sigma*2.5),lowerY=4.8*sigma;
  const height=Math.ceil(baseY+lowerY+32),lowerX=Math.max(1,width/2/1.1-32);
  const movingS=32/Math.sqrt(2*Math.log(2/threshold));
  const target=fabTarget(width,lowerX,lowerY,baseY,sigma,movingS,1,threshold,FAB_Y_OFFSET);
  return {left:target.x-44,top:target.y-(height-64)};
}
