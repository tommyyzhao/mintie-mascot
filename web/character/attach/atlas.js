// Shared, static vector atlas: one upload, no per-frame canvas work or platform emoji glyphs.
export const FX = ['hearts','sparkles','tears','sweat','anger','zzz','question','exclaim','notes','confetti','fire','steam','dizzy','lightbulb','sweatdrops','blushlines'];
export const ACCESSORIES = ['sunglasses','halo','horns','partyhat','glasses','cowboy','mask','monocle','crown'];
const TAU=Math.PI*2;
export function createAtlas(THREE){
 const names=[...FX,...ACCESSORIES,'blush'];
 const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;
 const ctx=canvas.getContext('2d'),cell=256,cols=8;
 const stroke=(color='#5a3d25',width=4)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();};
 const path=(points,close=false)=>{ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);if(close)ctx.closePath();};
 const ellipse=(x,y,rx,ry,color)=>{ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,TAU);ctx.fillStyle=color;ctx.fill();};
 const star=(x,y,r,color,n=4)=>{ctx.beginPath();for(let i=0;i<n*2;i++){const a=i*Math.PI/n-Math.PI/2,rr=i%2?r*.32:r;ctx[i?'lineTo':'moveTo'](x+Math.cos(a)*rr,y+Math.sin(a)*rr);}ctx.closePath();ctx.fillStyle=color;ctx.fill();};
 const heart=(x,y,r,color)=>{ctx.beginPath();ctx.moveTo(x,y+r*.8);ctx.bezierCurveTo(x-r*1.65,y-r*.2,x-r*.8,y-r*1.4,x,y-r*.55);ctx.bezierCurveTo(x+r*.8,y-r*1.4,x+r*1.65,y-r*.2,x,y+r*.8);ctx.fillStyle=color;ctx.fill();};
 const drop=(x,y,r,color)=>{ctx.beginPath();ctx.moveTo(x,y-r);ctx.bezierCurveTo(x-r*.35,y-r*.2,x-r*.8,y+r*.2,x-r*.65,y+r*.6);ctx.bezierCurveTo(x-r*.35,y+r*1.05,x+r*.45,y+r*1.05,x+r*.65,y+r*.6);ctx.bezierCurveTo(x+r*.8,y+r*.2,x+r*.35,y-r*.2,x,y-r);ctx.fillStyle=color;ctx.fill();ellipse(x-r*.25,y+r*.35,r*.11,r*.24,'#e4fcff');};
 const text=(value,color,size=152)=>{ctx.font=`900 ${size}px Georgia, serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(value,128,133);};
 names.forEach((name,i)=>{ctx.save();ctx.translate((i%cols)*cell,Math.floor(i/cols)*cell);
  if(name==='hearts'){heart(128,130,83,'#f7758d');heart(101,99,25,'#ffb7c4');}
  if(name==='sparkles'||name==='dizzy'){star(128,128,101,'#f9bd24',name==='dizzy'?5:4);star(111,106,34,'#fff0a6',name==='dizzy'?5:4);}
  if(['tears','sweat','sweatdrops'].includes(name))drop(128,123,91,'#5abde4');
  if(name==='anger'){ctx.strokeStyle='#d95049';ctx.lineWidth=17;for(let j=0;j<4;j++){ctx.save();ctx.translate(128,128);ctx.rotate(j*Math.PI/2);ctx.beginPath();ctx.moveTo(25,70);ctx.quadraticCurveTo(25,25,70,25);ctx.stroke();ctx.restore();}}
  if(name==='zzz'){ctx.font='italic 900 122px Georgia';ctx.fillStyle='#8075ab';ctx.fillText('z',48,202);ctx.font='italic 900 92px Georgia';ctx.fillText('z',122,116);ctx.font='italic 900 64px Georgia';ctx.fillText('z',190,57);}
  if(name==='question')text('?','#9a78c7',210);
  if(name==='exclaim')text('!','#eb7b55',216);
  if(name==='notes'){text('♫','#b780bc',196);}
  if(name==='confetti'){ctx.save();ctx.translate(128,128);ctx.rotate(-.4);ctx.fillStyle='#f58497';ctx.fillRect(-30,-80,60,160);ctx.restore();}
  if(name==='fire'){ctx.beginPath();ctx.moveTo(128,17);ctx.bezierCurveTo(144,82,213,84,211,155);ctx.bezierCurveTo(211,248,43,248,44,153);ctx.bezierCurveTo(39,108,86,88,86,64);ctx.lineTo(107,109);ctx.quadraticCurveTo(145,77,128,17);ctx.fillStyle='#f5a13c';ctx.fill();ctx.beginPath();ctx.moveTo(128,111);ctx.bezierCurveTo(185,172,183,220,126,228);ctx.bezierCurveTo(74,219,76,177,128,111);ctx.fillStyle='#ffe895';ctx.fill();}
  if(name==='steam'){for(const [x,y,r] of [[74,156,46],[128,106,60],[174,152,49]])ellipse(x,y,r,r,'#e0dacf');}
  if(name==='lightbulb'){ellipse(128,100,74,76,'#ffdc65');ctx.beginPath();ctx.moveTo(83,142);ctx.lineTo(96,192);ctx.quadraticCurveTo(128,213,160,192);ctx.lineTo(174,142);ctx.fillStyle='#ffdc65';ctx.fill();path([[106,181],[94,94],[127,115],[159,94],[148,181]]);stroke('#c0892f',6);for(let y=194;y<221;y+=9){path([[100,y],[156,y]]);stroke('#8e8063',7);}for(let j=0;j<7;j++){const a=j*Math.PI/5-Math.PI*1.1;path([[128+Math.cos(a)*91,100+Math.sin(a)*91],[128+Math.cos(a)*110,100+Math.sin(a)*110]]);stroke('#edbd37',6);}}
  if(name==='blushlines'){for(let j=0;j<3;j++){path([[66+j*49,170],[94+j*49,84]]);stroke('#c86064',10);}}
  if(name==='blush'){const g=ctx.createRadialGradient(128,128,0,128,128,111);g.addColorStop(0,'rgba(255,143,163,.70)');g.addColorStop(.45,'rgba(255,143,163,.55)');g.addColorStop(.8,'rgba(255,143,163,.22)');g.addColorStop(1,'rgba(255,143,163,0)');ellipse(128,128,112,112,g);}
  if(name==='sunglasses'||name==='glasses'||name==='monocle'){
   const glass=name==='sunglasses',xs=name==='monocle'?[173]:[65,190];
   xs.forEach(x=>{ctx.beginPath();ctx.roundRect(x-48,77,94,96,glass?23:40);ctx.fillStyle=glass?'#293c35':'rgba(199,235,217,.18)';ctx.fill();stroke(glass?'#253a2f':'#a16f37',10);if(glass){path([[x-29,94],[x+3,94],[x-25,137]]);ctx.closePath();ctx.fillStyle='#829887';ctx.fill();}});
   if(name!=='monocle'){ctx.beginPath();ctx.moveTo(109,115);ctx.quadraticCurveTo(128,104,143,115);stroke(glass?'#253a2f':'#a16f37',9);path([[16,104],[4,94]]);stroke('#384c37',8);path([[237,104],[251,94]]);stroke('#384c37',8);}else{ctx.beginPath();ctx.moveTo(211,167);ctx.bezierCurveTo(211,228,179,243,161,214);stroke('#bd934d',4);}
  }
  if(name==='halo'){ctx.beginPath();ctx.ellipse(128,123,104,40,-.1,0,TAU);stroke('#dda935',18);ctx.beginPath();ctx.ellipse(128,118,104,40,-.1,Math.PI,TAU);stroke('#ffe998',10);}
  if(name==='horns'){for(const s of [-1,1]){ctx.save();ctx.translate(128,128);ctx.scale(s,1);ctx.beginPath();ctx.moveTo(30,85);ctx.quadraticCurveTo(125,49,92,-86);ctx.quadraticCurveTo(62,-34,33,-22);ctx.quadraticCurveTo(19,17,30,85);ctx.fillStyle='#db7d69';ctx.fill();stroke('#9a5344',4);ctx.restore();}}
  if(name==='partyhat'){ctx.beginPath();ctx.moveTo(123,22);ctx.quadraticCurveTo(133,8,139,25);ctx.lineTo(213,217);ctx.quadraticCurveTo(128,247,43,217);ctx.closePath();ctx.fillStyle='#edb05c';ctx.fill();stroke('#9e7142',4);ctx.save();ctx.clip();for(let j=0;j<6;j++){path([[-15,170+j*36],[242,32+j*36]]);stroke(j%2?'#b997c3':'#f8d998',21);}ctx.restore();ellipse(129,23,18,18,'#f397a6');}
  if(name==='cowboy'){ctx.beginPath();ctx.moveTo(67,139);ctx.lineTo(78,53);ctx.quadraticCurveTo(94,30,127,60);ctx.quadraticCurveTo(168,22,181,51);ctx.lineTo(193,139);ctx.fillStyle='#bc915b';ctx.fill();stroke('#785531',5);ctx.beginPath();ctx.moveTo(69,121);ctx.quadraticCurveTo(129,140,190,118);stroke('#765039',17);ctx.beginPath();ctx.moveTo(19,131);ctx.bezierCurveTo(75,182,193,181,240,125);ctx.bezierCurveTo(251,209,7,223,19,131);ctx.fillStyle='#d0a66c';ctx.fill();stroke('#785531',5);}
  if(name==='mask'){ctx.beginPath();ctx.moveTo(57,73);ctx.quadraticCurveTo(128,93,199,73);ctx.lineTo(196,181);ctx.quadraticCurveTo(128,213,60,181);ctx.closePath();ctx.fillStyle='#d6e8dc';ctx.fill();stroke('#779f96',4);for(let y=107;y<175;y+=23){path([[72,y],[183,y]]);stroke('#9ebfb2',4);}for(const s of [-1,1]){ctx.beginPath();ctx.ellipse(128+s*88,130,29,49,0,0,TAU);stroke('#a4bfb1',5);}}
  if(name==='crown'){path([[29,197],[21,68],[78,117],[127,38],[180,116],[234,68],[224,198]],true);ctx.fillStyle='#f8ce57';ctx.fill();stroke('#ae7d35',5);ctx.fillStyle='#d99e34';ctx.fillRect(33,177,189,26);for(const [x,y] of [[22,65],[127,35],[234,65]])ellipse(x,y,9,9,'#ffeaa5');ellipse(127,151,11,15,'#df8e93');ellipse(71,157,7,10,'#85ad8c');ellipse(184,157,7,10,'#85ad8c');}
  ctx.restore();
 });
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 return {texture,names,geometry(name){const i=names.indexOf(name);if(i<0)throw new Error(`Unknown attachment tile: ${name}`);const g=new THREE.PlaneGeometry(1,1),uv=g.attributes.uv;const x=i%cols,y=Math.floor(i/cols);for(let j=0;j<uv.count;j++)uv.setXY(j,(x+uv.getX(j))/cols,1-(y+1-uv.getY(j))/cols);return g;},dispose(){texture.dispose();}};
}
