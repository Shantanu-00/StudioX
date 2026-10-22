"""Continuous 60 fps optical compositing study; not a Vega runtime renderer.

Uses a moving feathered reveal, display-space fades, a refractive displacement
field, independently lit bevels, and time-sampled impact motion. V1/V2 untouched.
"""
import argparse
import json
import math
from pathlib import Path
import shutil
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
W, H, FPS, IMPACT = 1920, 1080, 60, 5.43
FONT = '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf'
RNG = np.random.default_rng(5284)


def smooth(a, b, x):
    u = np.clip((x-a)/(b-a), 0, 1)
    return u*u*(3-2*u)


def scalar(a, b, x):
    return float(smooth(a,b,x))


def glyphs():
    font = ImageFont.truetype(FONT, 170)
    widths = [font.getbbox(c)[2] for c in 'STUDIOX']
    total = sum(widths)+6*9
    cursor = (W-total)//2
    result=[]
    for i,(c,width) in enumerate(zip('STUDIOX',widths)):
        box=font.getbbox(c)
        tile=Image.new('L',(width+12,190))
        ImageDraw.Draw(tile).text((6,14-box[1]),c,font=font,fill=255)
        result.append((cursor-6, 466, np.asarray(tile,dtype=np.float32)/255))
        cursor+=width+9
    return result


GLYPHS=glyphs()
# Full-frame maps are static. Time changes only the propagation and light envelopes.
XX=np.arange(W,dtype=np.float32)[None,:]
YY=np.arange(H,dtype=np.float32)[:,None]
nodes=np.linspace(0,W,100)
noise=np.interp(np.arange(W),nodes,RNG.normal(0,1.5,len(nodes)))
line=(170+.36*np.arange(W)+noise).astype(np.float32)
width=(25*np.sin(np.linspace(0,math.pi,W))**4+4).astype(np.float32)
dist=YY-line[None,:]
secondary=dist-width[None,:]
lens=(smooth(-2,2,dist)*(1-smooth(width[None,:]-2,width[None,:]+2,dist)))
profile=1-np.abs(2*np.clip(dist/width[None,:],0,1)-1)
# A tilted sliver displaces the underlying image; bevel normals bend it locally.
dx=(lens*(4+4*profile)+2.3*np.tanh(dist/1.8)).astype(np.float32)
dy=(-lens*(2+2*profile)-1.0*np.tanh(dist/1.8)).astype(np.float32)
# Bevel reflection changes along the crack, with tiny interruptions and edge roughness.
variation=(.40+.32*np.sin(XX*.019)**2+.28*np.sin(XX*.073+.3)**4)
bevel=(np.exp(-((dist-1.0)/1.1)**2)*.65+np.exp(-((secondary+.8)/.85)**2)*.40)*variation
broad=(np.exp(-((dist-2.4)/3.2)**2)*.07+np.exp(-((secondary+1.6)/2.5)**2)*.04)
seam=(np.exp(-(dist/.65)**2)*.65+np.exp(-(secondary/.6)**2)*.38)
branches=Image.new('L',(W,H));bd=ImageDraw.Draw(branches)
for n in range(22):
    x=float(RNG.uniform(200,1720)); y=float(np.interp(x,np.arange(W),line))
    length=float(RNG.uniform(45,240)); sign=RNG.choice([-1,1]); pts=[(x,y)]
    for k in range(1,7):
        u=k/6;pts.append((x-length*u,y-.36*length*u+sign*18*math.sin(u*math.pi*.8)))
    bd.line(pts,fill=int(RNG.uniform(10,48)),width=1)
branch=np.asarray(branches,dtype=np.float32)/255
# Local refraction only needs the central text region, including glow margin.
RX0,RY0,RX1,RY1=450,390,1470,740
GX,GY=np.meshgrid(np.arange(RX0,RX1,dtype=np.float32),np.arange(RY0,RY1,dtype=np.float32))


def sample(a,x,y):
    x=np.clip(x,0,a.shape[1]-1.001);y=np.clip(y,0,a.shape[0]-1.001)
    ix=x.astype(np.int32);iy=y.astype(np.int32);fx=x-ix;fy=y-iy
    if a.ndim==3:fx=fx[:,:,None];fy=fy[:,:,None]
    return ((a[iy,ix]*(1-fx)+a[iy,ix+1]*fx)*(1-fy)+
            (a[iy+1,ix]*(1-fx)+a[iy+1,ix+1]*fx)*fy)


def title(t):
    rgb=np.zeros((350,1020,3),dtype=np.float32)
    # Different small timing offsets share the same continuous reveal/fade shape.
    starts=[.68,.55,.44,.37,.46,.58,.72]
    ends=[9.43,9.50,9.39,9.48,9.45,9.51,9.72]
    fade_starts=[8.04,8.10,8.00,8.13,8.06,8.11,8.22]
    for i,(x,y,glyph) in enumerate(GLYPHS):
        h,w=glyph.shape;ly,lx=np.mgrid[0:h,0:w]
        p=scalar(starts[i],3.20+(i%2)*.07,t)
        # Feathered angled aperture travels across actual glyph pixels every frame.
        tilt=(ly-75)*(.34 if i%2 else -.34)
        boundary=(w*.5+h*.18+8)*p
        coverage=(1-smooth(boundary-3,boundary+3,np.abs(lx-w*.5+tilt)))*scalar(0,.025,p)
        envelope=1-scalar(fade_starts[i],ends[i],t)
        light=scalar(.34,.62,t)*envelope
        reveal=glyph*coverage
        ghost=np.fliplr(glyph)*coverage
        ghost_amount=.38*(1-scalar(.20,.95,p))*scalar(0,.12,p)
        # Tiny lateral optical echo converges continuously, without changing scale.
        echo_shift=12*(1-p)*(-1 if i%2 else 1)
        read_x=np.arange(w,dtype=np.float32)-echo_shift
        valid=(read_x>=0)&(read_x<=w-1)
        clipped=np.clip(read_x,0,w-1);left=clipped.astype(np.int32);mix=clipped-left
        ghost=(ghost[:,left]*(1-mix)+ghost[:,np.minimum(left+1,w-1)]*mix)*valid
        m=(reveal*(.64+.36*p)+ghost*ghost_amount)*light
        color=np.array([1,.035,.105] if i==6 else [.91,.965,1],dtype=np.float32)
        a=x-RX0;b=y-RY0
        rgb[b:b+h,a:a+w]+=m[:,:,None]*color
    # Blur grows gently during extinction, eliminating a late hard cut.
    image=Image.fromarray(np.uint8(np.clip(rgb,0,1)*255))
    blur=.28+1.4*scalar(8.35,9.65,t)
    core=np.asarray(image.filter(ImageFilter.GaussianBlur(blur)),dtype=np.float32)/255
    halo1=np.asarray(image.filter(ImageFilter.GaussianBlur(3.2)),dtype=np.float32)/255
    halo2=np.asarray(image.filter(ImageFilter.GaussianBlur(12)),dtype=np.float32)/255
    core+=halo1*.16+halo2*np.array([.055,.11,.18],dtype=np.float32)
    return np.clip(core,0,1)


def shake(t):
    pre=scalar(4.88,5.40,t)*(1-scalar(IMPACT,IMPACT+.1,t))
    after=math.exp(-max(0,t-IMPACT)*6) if t>=IMPACT else 0
    tail=scalar(8.1,8.5,t)*(1-scalar(8.5,9.3,t))*.22
    amp=.85*pre+1.7*after+tail
    return amp*math.sin(t*math.tau*6.2),amp*.55*math.sin(t*math.tau*8.1)


def render(t):
    if t<.34 or t>=9.75:return np.zeros((H,W,3),dtype=np.uint8)
    word=title(t)
    # The fast crack front sweeps from bottom right to upper left.
    front=W*(1-scalar(IMPACT-.035,IMPACT+.115,t))
    progress=smooth(front-30,front+30,XX)
    impact=scalar(IMPACT-.04,IMPACT+.14,t)
    tail=1-scalar(8.20,9.68,t)
    local=progress[:,RX0:RX1]*impact
    offx=dx[RY0:RY1,RX0:RX1]*local
    offy=dy[RY0:RY1,RX0:RX1]*local
    sx,sy=shake(t)
    lx=GX-RX0+offx;ly=GY-RY0+offy
    refracted=sample(word,lx,ly)
    # Very restrained chromatic edge separation within the glass wedge.
    dispersion=lens[RY0:RY1,RX0:RX1]*local*.48
    refracted[:,:,0]=sample(word[:,:,0],lx+dispersion,ly)
    refracted[:,:,2]=sample(word[:,:,2],lx-dispersion,ly)
    rgb=np.zeros((H,W,3),dtype=np.float32)
    rgb[RY0:RY1,RX0:RX1]=refracted
    # Light caught from the title changes how the bevel reads, not just line color.
    illumination=np.zeros((H,W),dtype=np.float32)
    illumination[RY0:RY1,RX0:RX1]=np.asarray(
        Image.fromarray(np.uint8(np.max(word,axis=2)*255)).filter(ImageFilter.GaussianBlur(19)),
        dtype=np.float32)/255
    glint=(bevel+broad+branch)*(.33+illumination*1.0)
    glint*=progress*impact*tail*(1+.55*math.exp(-max(0,t-IMPACT)*10))
    rgb*=1-seam[:,:,None]*progress[:,:,None]*impact*.7
    rgb+=glint[:,:,None]*np.array([.78,.88,1],dtype=np.float32)
    # Broad, almost invisible reflection inside the sliver gives optical depth.
    rgb+=lens[:,:,None]*illumination[:,:,None]*progress[:,:,None]*tail*.035
    result=Image.fromarray(np.uint8(np.clip(rgb,0,1)*255+.5))
    if abs(sx)+abs(sy)>.001:
        result=result.transform((W,H),Image.Transform.AFFINE,(1,0,-sx,0,1,-sy),
                                resample=Image.Resampling.BILINEAR)
    return np.asarray(result)


def save_layers(output):
    assets=output/'optical-assets';assets.mkdir(exist_ok=True)
    reflection=np.clip((bevel+broad+branch)*.8,0,1)
    a=np.uint8(reflection*255)
    rgba=np.zeros((H,W,4),dtype=np.uint8);rgba[:,:,:3]=[199,224,255];rgba[:,:,3]=a
    Image.fromarray(rgba).save(assets/'glass-reflection.png')
    rgba[:,:,:3]=0;rgba[:,:,3]=np.uint8(np.clip(seam,0,1)*255)
    Image.fromarray(rgba).save(assets/'glass-dark-seam.png')
    Image.fromarray(np.uint8(lens*255)).save(assets/'glass-lens-mask.png')
    for i,(x,y,mask) in enumerate(GLYPHS):
        rgba=np.zeros((*mask.shape,4),dtype=np.uint8)
        rgba[:,:,:3]=[255,9,27] if i==6 else [232,246,255]
        rgba[:,:,3]=np.uint8(mask*255)
        Image.fromarray(rgba).save(assets/f'glyph-{i}.png')
    (assets/'layout.json').write_text(json.dumps({'canvas':[W,H],'glyph_origins':[[x,y] for x,y,_ in GLYPHS],
        'note':'Source layers for a native compositing prototype. Dynamic displacement/glow in the proof is not automatically reproduced by these PNGs.'},indent=2))


def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=ROOT/'docs/local/intro/v3')
    p.add_argument('--stills',action='store_true');p.add_argument('--render',action='store_true')
    p.add_argument('--audio',type=Path);args=p.parse_args()
    output=args.output.resolve()
    if output in [ROOT/'docs/local/intro/render',ROOT/'docs/local/intro/v2']:
        raise ValueError('Preserved output directory; choose v3 or a new directory.')
    output.mkdir(parents=True,exist_ok=True);save_layers(output)
    if args.stills:
        for t in [.7,1.3,2,2.6,3.5,5.6,8.8,9.3,9.55]:
            Image.fromarray(render(t)).save(output/f'still-{round(t*100):04d}.png')
    if args.render:
        sound=args.audio or output/'studiox-reference-soundtrack.wav'
        if not sound.exists():sound=ROOT/'docs/local/intro/v2/studiox-reference-soundtrack.wav'
        destination=output/'studiox-reference-soundtrack.wav'
        if sound.resolve()!=destination.resolve():shutil.copyfile(sound,destination)
        sound=destination
        cmd=['ffmpeg','-v','warning','-y','-f','rawvideo','-pixel_format','rgb24',
             '-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','-', '-i',str(output/sound.name),
             '-c:v','libx264','-preset','medium','-crf','16','-threads','2','-pix_fmt','yuv420p',
             '-force_key_frames','0,9.75','-c:a','aac','-b:a','256k','-t','10','-movflags','+faststart',
             str(output/'studiox-intro-v3-60fps.mp4')]
        process=subprocess.Popen(cmd,stdin=subprocess.PIPE)
        proof=output/'motion-samples';proof.mkdir(exist_ok=True)
        frames=output/'frames';frames.mkdir(exist_ok=True)
        # Each checkpoint is keyed to the renderer source and canvas/frame-rate.
        import hashlib
        identity=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        identity_file=frames/'source.sha256'
        if identity_file.exists() and identity_file.read_text()!=identity:
            raise RuntimeError('Frame source changed; choose a fresh output directory or clear only its frame cache.')
        identity_file.write_text(identity)
        for f in range(600):
            t=f/FPS
            destination=frames/f'{f:04d}.png'
            if destination.exists():
                image=np.asarray(Image.open(destination).convert('RGB'))
            else:
                # Temporal samples around fracture/tremor, not duplicated video frames.
                if 4.88<=t<=5.85:
                    a=render(t);b=render(t+1/(FPS*3))
                    image=np.uint8((a.astype(np.float32)+b)*.5+.5)
                else:image=render(t)
                temporary=destination.with_suffix('.part.png')
                Image.fromarray(image).save(temporary)
                temporary.replace(destination)
            process.stdin.write(image.tobytes())
            if f in range(30,195,3) or f in range(510,585,3):
                Image.fromarray(image).resize((480,270)).save(proof/f'{f:04d}.png')
            if f%30==0:print(f'V3_FRAME {f}/600',flush=True)
        process.stdin.close()
        if process.wait()!=0:raise RuntimeError('FFmpeg encoding failed')
        subprocess.run(['ffmpeg','-v','warning','-y','-i',str(output/'studiox-intro-v3-60fps.mp4'),
                        '-an','-c:v','copy',str(output/'studiox-intro-v3-silent.mp4')],check=True)
        print('V3 complete',flush=True)


if __name__=='__main__':main()
