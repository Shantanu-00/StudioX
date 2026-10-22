"""Ten-second digital-fragment title proof; not a Vega runtime renderer.

Continuous subpixel fragment assembly, opposing rigid glass panes, cool depth,
time-sampled tremor, and overlapping extinction. V1 through V4 stay untouched.
"""
import argparse
import json
import math
from pathlib import Path
import shutil
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
W, H, FPS, IMPACT = 1920, 1080, 60, 4.25
ASSETS = ROOT/'docs/local/intro/v5/optical-assets'
RNG = np.random.default_rng(5284)


def smooth(a, b, x):
    u = np.clip((x-a)/(b-a), 0, 1)
    return u*u*(3-2*u)


def scalar(a, b, x):
    return float(smooth(a,b,x))


def glyphs():
    # Reuse the approved v4 letter masks, independent of host font installation.
    layout=json.loads((ASSETS/'layout.json').read_text())
    result=[]
    for i,(x,y) in enumerate(layout['glyph_origins']):
        tile=Image.open(ASSETS/f'glyph-{i}.png').getchannel('A')
        result.append((x,y,np.asarray(tile,dtype=np.float32)/255))
    return result


GLYPHS=glyphs()
# Hand-traced fracture graph from the user's 1594×651 reference.
# Uniform scaling preserves the angles of the cropped source image.
SCALE=W/1594
OFFSET_Y=540-350*SCALE
TRACE_TOP=[(0,5),(110,55),(247,112),(366,159),(408,172),(518,219),
           (592,255),(679,282),(703,300),(791,340),(878,376),(958,419),
           (1043,455),(1117,489),(1248,544),(1405,606),(1544,650),(1594,672)]
TRACE_LOWER=[(150,240),(280,271),(361,293),(485,334),(585,349),(685,373),
             (739,388),(832,416),(882,432),(970,455),(1000,463),(1060,480),(1127,494)]
TRACE_PATHS=[
    ('upper-left',TRACE_TOP[:4],.72,.14),
    ('backbone',TRACE_TOP[4:],.82,.18),
    ('lower-fork',TRACE_LOWER[:10],.76,.18),
    ('lower-return',TRACE_LOWER[10:],.60,.14),
    ('central-feather-1',[(679,282),(697,294),(712,322),(725,352),(738,383)],.70,.42),
    ('central-feather-2',[(692,289),(710,305),(722,334),(731,365),(738,383)],.55,.31),
    ('central-feather-3',[(703,300),(721,335),(728,362),(735,378)],.56,.28),
    ('central-fork',[(703,300),(729,311),(791,340),(829,356)],.66,.34),
    ('long-splinter',[(721,335),(738,383),(792,399),(832,416),(878,430)],.72,.30),
    ('thin-splinter',[(738,383),(786,393),(832,416),(882,432)],.48,.20),
    ('diagonal-chip',[(791,340),(811,375),(838,405),(882,432),(926,445)],.52,.20),
    ('return-chip',[(832,416),(855,417),(882,432),(970,455)],.52,.20),
    ('right-triangle',[(1027,466),(1043,455),(1089,474),(1060,480),(1027,466)],.60,.25),
    ('right-needle',[(1043,455),(1066,468),(1089,474),(1117,489),(1127,494)],.56,.31),
    ('right-spur',[(1060,480),(1094,484),(1117,489),(1193,521)],.48,.13),
    ('upper-edge-chip',[(518,219),(531,231),(566,243),(592,255)],.48,.18),
    ('upper-edge-flake',[(592,255),(621,262),(652,276),(679,282)],.50,.23),
    ('lower-fine-edge',[(361,293),(419,313),(485,334),(535,339),(585,349)],.46,.12),
]
TRACE_PATHS += [
    ('bevel-fleck-a',[(696,294),(702,304),(705,313)],.46,.48),
    ('bevel-fleck-b',[(710,315),(714,327),(718,336)],.42,.52),
    ('bevel-fleck-c',[(721,343),(726,356),(729,364)],.44,.46),
    ('bevel-fleck-d',[(731,370),(735,378),(739,383)],.48,.54),
    ('return-fleck-a',[(745,389),(756,391),(765,395)],.42,.43),
    ('return-fleck-b',[(791,400),(803,404),(812,409)],.45,.40),
    ('return-fleck-c',[(857,423),(867,426),(878,431)],.38,.34),
    ('right-fleck-a',[(1045,459),(1054,465),(1063,470)],.46,.50),
    ('right-fleck-b',[(1075,473),(1082,475),(1087,476)],.44,.43),
    ('right-fleck-c',[(1094,484),(1104,486),(1111,489)],.38,.35),
]
AA=3

def traced_point(p):
    return (p[0]*SCALE,p[1]*SCALE+OFFSET_Y)


def polygon_mask(points):
    canvas=Image.new('L',(W*AA,H*AA));draw=ImageDraw.Draw(canvas)
    draw.polygon([(round(traced_point(p)[0]*AA),round(traced_point(p)[1]*AA)) for p in points],fill=255)
    return np.asarray(canvas.resize((W,H),Image.Resampling.LANCZOS),dtype=np.float32)/255


def stroke_map(paths, dark=False):
    canvas=Image.new('L',(W*AA,H*AA));draw=ImageDraw.Draw(canvas)
    rng=np.random.default_rng(401)
    for name,points,weight,strength in paths:
        for a,b in zip(points[:-1],points[1:]):
            mid=(a[0]+b[0])/2
            # Highlights concentrate at real fork points, not uniformly down rails.
            attenuation=.65 if mid<400 or mid>1180 else 1
            level=strength*attenuation*float(rng.uniform(.65,1.2))
            if dark:level=min(.85,strength*2.4)
            segment_weight=weight+.35 if dark else weight
            pa=traced_point(a);pb=traced_point(b)
            shift=.72 if dark else 0
            draw.line([(round(pa[0]*AA),round((pa[1]+shift)*AA)),
                       (round(pb[0]*AA),round((pb[1]+shift)*AA))],
                      fill=round(min(1,level)*255),width=max(1,round(segment_weight*SCALE*AA)))
    return np.asarray(canvas.resize((W,H),Image.Resampling.LANCZOS),dtype=np.float32)/255


XX=np.arange(W,dtype=np.float32)[None,:]
YY=np.arange(H,dtype=np.float32)[:,None]
top_x=np.array([p[0]*SCALE for p in TRACE_TOP]);top_y=np.array([traced_point(p)[1] for p in TRACE_TOP])
line=np.interp(np.arange(W),top_x,top_y).astype(np.float32)
# Opposing rigid transforms break the baseline at the actual fracture boundary.
# These are inverse sampling transforms, so positive dy moves the image upward.
side=smooth(-.55,.55,YY-line[None,:]).astype(np.float32)
theta=np.deg2rad(np.where(side>.5,-.30,.38)).astype(np.float32)
px,py=XX-960,YY-540
dx=(np.cos(theta)-1)*px-np.sin(theta)*py+np.where(side>.5,-3.0,3.4)
dy=np.sin(theta)*px+(np.cos(theta)-1)*py+np.where(side>.5,-4.0,4.8)
dx=dx.astype(np.float32);dy=dy.astype(np.float32)
SHARDS=[
    ([(679,282),(703,300),(791,340),(878,376),(958,419),(970,455),
      (882,432),(832,416),(739,388),(685,373)],6.0,-3.6),
    ([(703,300),(721,335),(738,383),(729,375),(711,327)],-12.0,5.2),
    ([(710,305),(728,318),(738,383),(731,366)],10.0,-4.4),
    ([(738,383),(791,340),(811,375),(832,416)],-7.4,3.2),
    ([(811,375),(838,405),(882,432),(832,416)],6.4,-3.6),
]
lens=np.zeros((H,W),dtype=np.float32)
for outline,shift_x,shift_y in SHARDS:
    mask=polygon_mask(outline)
    dx=dx*(1-mask)+shift_x*mask;dy=dy*(1-mask)+shift_y*mask
    lens=np.maximum(lens,mask)
bevel=stroke_map(TRACE_PATHS)
seam=stroke_map(TRACE_PATHS,dark=True)
# Tiny triangular chips provide localized reflecting faces; interiors remain clear.
facets=[
    ([(697,294),(708,306),(721,335)],.10),
    ([(710,305),(717,313),(731,365)],.09),
    ([(721,335),(728,349),(738,383)],.12),
    ([(738,383),(765,388),(792,399)],.05),
    ([(832,416),(855,417),(882,432)],.08),
    ([(1043,455),(1055,463),(1089,474)],.11),
    ([(1060,480),(1094,484),(1117,489)],.07),
]
facets += [
    ([(700,301),(702,302),(710,322)],.28),
    ([(717,331),(720,335),(728,359)],.24),
    ([(731,368),(733,371),(738,382)],.30),
    ([(754,390),(758,392),(776,397)],.18),
    ([(1048,462),(1051,462),(1066,471)],.24),
    ([(1085,477),(1087,479),(1104,485)],.18),
]
facet=np.zeros((H,W),dtype=np.float32)
for outline,level in facets:facet+=polygon_mask(outline)*level
# No smooth bulging profile, broad blue ribbon, or rounded caustic.
broad=np.zeros((H,W),dtype=np.float32)
branch=facet

# The clean plate preserves fine glass texture from the reference-assisted edit.
# It is composited as light over black; hand-traced regions control rigid refraction.
PLATE_PATH=ROOT/'docs/local/intro/v5/optical-assets/reference-fracture-plate.png'
plate_source=Image.open(PLATE_PATH).convert('RGB')
plate_height=round(plate_source.height*W/plate_source.width)
plate_canvas=Image.new('RGB',(W,H))
plate_canvas.paste(plate_source.resize((W,plate_height),Image.Resampling.LANCZOS),(0,round(OFFSET_Y)))
PLATE=np.asarray(plate_canvas,dtype=np.float32)/255

# Local refraction only needs the central text region, including glow margin.
RX0,RY0,RX1,RY1=450,390,1470,740
GX,GY=np.meshgrid(np.arange(RX0,RX1,dtype=np.float32),np.arange(RY0,RY1,dtype=np.float32))


def sample(a,x,y):
    x=np.clip(x,0,a.shape[1]-1.001);y=np.clip(y,0,a.shape[0]-1.001)
    ix=x.astype(np.int32);iy=y.astype(np.int32);fx=x-ix;fy=y-iy
    if a.ndim==3:fx=fx[:,:,None];fy=fy[:,:,None]
    return ((a[iy,ix]*(1-fx)+a[iy,ix+1]*fx)*(1-fy)+
            (a[iy+1,ix]*(1-fx)+a[iy+1,ix+1]*fx)*fy)


def digital_fragments():
    """Partition real glyph strokes; seeded timings have no spatial reveal edge."""
    fragments=[]
    for i,(x,y,glyph) in enumerate(GLYPHS):
        h,w=glyph.shape
        mirrored=np.fliplr(glyph)
        row=0
        while row<h:
            rh=int(RNG.integers(14,27));col=0
            while col<w:
                cw=int(RNG.integers(18,38))
                correct=glyph[row:row+rh,col:col+cw].copy()
                wrong=mirrored[row:row+rh,col:col+cw].copy()
                if max(correct.max(),wrong.max())>.01:
                    start=float(RNG.uniform(.28,1.65))
                    settle=float(RNG.uniform(2.48,3.04))
                    fragments.append((i,x+col-RX0,y+row-RY0,correct,wrong,
                        start,settle,float(RNG.uniform(-46,46)),
                        float(RNG.uniform(-19,19)),float(RNG.uniform(0,math.tau))))
                col+=cw
            row+=rh
    return fragments


FRAGMENTS=digital_fragments()
COLORS=[np.array([1,.035,.105] if i==6 else [.87,.93,.99],dtype=np.float32)
        for i in range(7)]
FADE_STARTS=[7.24,7.38,7.18,7.34,7.27,7.40,7.56]
FADE_ENDS=[9.34,9.42,9.29,9.39,9.36,9.44,9.68]


def splat(rgb,mask,x,y,color,gain):
    """Bilinear forward translation, including zero outside a fragment's bounds."""
    if gain<.0001:return
    left=math.floor(x);top=math.floor(y);fx=x-left;fy=y-top
    h,w=mask.shape
    tile=mask[:,:,None]*color*gain
    for ox,oy,weight in [(0,0,(1-fx)*(1-fy)),(1,0,fx*(1-fy)),
                         (0,1,(1-fx)*fy),(1,1,fx*fy)]:
        if weight<.00001:continue
        x0=left+ox;y0=top+oy
        # The padded title ROI contains the complete fragment motion envelope.
        rgb[y0:y0+h,x0:x0+w]+=tile*weight


def title(t):
    rgb=np.zeros((RY1-RY0,RX1-RX0,3),dtype=np.float32)
    fades=[1-scalar(a,b,t) for a,b in zip(FADE_STARTS,FADE_ENDS)]
    if t>=3.04:
        for i,(x,y,glyph) in enumerate(GLYPHS):
            splat(rgb,glyph,x-RX0,y-RY0,COLORS[i],fades[i])
    else:
        for i,x,y,correct,wrong,start,settle,offset_x,offset_y,phase in FRAGMENTS:
            light=scalar(start,start+.24,t)*fades[i]
            if light<.0001:continue
            lock=scalar(1.30+(start-.28)*.24,settle,t)
            remainder=1-lock
            decode=scalar(1.50+(start-.28)*.32,settle-.04,t)
            mask=wrong*(1-decode)+correct*decode
            # Local fragments float at final cap height; no zoom or flipping plane.
            ox=offset_x*remainder+math.sin(t*14+phase)*2.6*remainder
            oy=offset_y*remainder+math.sin(t*9+phase)*1.1*remainder
            strength=light*(.58+.42*lock)
            splat(rgb,mask,x+ox,y+oy,COLORS[i],strength)
            # A short blue phosphor echo converges into each displaced stroke.
            splat(rgb,mask,x+ox+7*remainder,y+oy+1.3*remainder,
                  COLORS[i]*np.array([.24,.49,.80]),light*.24*remainder)
    image=Image.fromarray(np.uint8(np.clip(rgb,0,1)*255+.5))
    blur=.24+1.35*scalar(7.80,9.65,t)
    core=np.asarray(image.filter(ImageFilter.GaussianBlur(blur)),dtype=np.float32)/255
    halo1=np.asarray(image.filter(ImageFilter.GaussianBlur(3.1)),dtype=np.float32)/255
    halo2=np.asarray(image.filter(ImageFilter.GaussianBlur(13)),dtype=np.float32)/255
    # An offset blue-black echo creates depth on black without a heavy outline.
    shadow=image.transform(image.size,Image.Transform.AFFINE,(1,0,-3.5,0,1,-5),
                           resample=Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(6.5))
    depth=np.asarray(shadow,dtype=np.float32)/255
    core+=halo1*.12+halo2*np.array([.055,.10,.19],dtype=np.float32)
    core+=depth*np.array([.075,.15,.27],dtype=np.float32)
    return np.clip(core,0,1)


def shake(t):
    pre=scalar(3.45,IMPACT-.015,t)*(1-scalar(IMPACT,IMPACT+.10,t))
    after=math.exp(-max(0,t-IMPACT)*9) if t>=IMPACT else 0
    tail=scalar(7.8,8.2,t)*(1-scalar(8.2,9.2,t))*.15
    amp=2.8*pre+3.8*after+tail
    return (amp*(.78*math.sin(t*math.tau*7.2)+.22*math.sin(t*math.tau*12.1)),
            amp*.42*math.sin(t*math.tau*8.8+.7))


def render(t):
    if t<.28 or t>=9.70:return np.zeros((H,W,3),dtype=np.uint8)
    word=title(t)
    # The fast crack front sweeps from bottom right to upper left.
    front=W*(1-scalar(IMPACT-.035,IMPACT+.115,t))
    progress=smooth(front-30,front+30,XX)
    impact=scalar(IMPACT-.04,IMPACT+.14,t)
    tail=1-scalar(7.55,9.63,t)
    local=progress[:,RX0:RX1]*impact
    # Fast overshoot settles as a rigid pane, never a swelling lens.
    local=local*(1+.16*math.exp(-max(0,t-IMPACT)*13))
    offx=dx[RY0:RY1,RX0:RX1]*local
    offy=dy[RY0:RY1,RX0:RX1]*local
    sx,sy=shake(t)
    lx=GX-RX0+offx;ly=GY-RY0+offy
    refracted=sample(word,lx,ly)
    # Very restrained chromatic edge separation within the glass wedge.
    anticipation=scalar(IMPACT-.13,IMPACT-.055,t)*(1-scalar(IMPACT+.03,IMPACT+.18,t))
    dispersion=lens[RY0:RY1,RX0:RX1]*local*.24+anticipation*.70
    refracted[:,:,0]=sample(word[:,:,0],lx+dispersion,ly)
    refracted[:,:,2]=sample(word[:,:,2],lx-dispersion,ly)
    rgb=np.zeros((H,W,3),dtype=np.float32)
    rgb[RY0:RY1,RX0:RX1]=refracted
    rgb*=1-seam[:,:,None]*progress[:,:,None]*impact*.7
    rgb+=PLATE*progress[:,:,None]*impact*tail*(.66+.24*math.exp(-max(0,t-IMPACT)*10))
    # Broad, almost invisible reflection inside the sliver gives optical depth.
    # Reference plate supplies the reflecting faces; no filled liquid-like ribbon.
    result=Image.fromarray(np.uint8(np.clip(rgb,0,1)*255+.5))
    if abs(sx)+abs(sy)>.001:
        result=result.transform((W,H),Image.Transform.AFFINE,(1,0,-sx,0,1,-sy),
                                resample=Image.Resampling.BILINEAR)
    return np.asarray(result)


def save_trace(assets):
    trace={'reference_dimensions':[1594,651],'scale':SCALE,'offset_y':OFFSET_Y,
           'paths':[{'name':n,'points':pts,'width':w,'strength':s} for n,pts,w,s in TRACE_PATHS],
           'rigid_shards':[{'points':pts,'dx':x,'dy':y} for pts,x,y in SHARDS]}
    (assets/'fracture-trace.json').write_text(json.dumps(trace,indent=2))
    paths=[]
    for name,points,weight,strength in TRACE_PATHS:
        coords=[traced_point(p) for p in points]
        path='M '+' L '.join(f'{x:.3f} {y:.3f}' for x,y in coords)
        paths.append(f'<path id="{name}" d="{path}" fill="none" stroke="#c7e0ff" stroke-opacity="{strength}" stroke-width="{weight*SCALE:.3f}"/>')
    (assets/'fracture-paths.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">'+''.join(paths)+'</svg>')


def save_layers(output):
    assets=output/'optical-assets';assets.mkdir(exist_ok=True)
    reflection=np.clip((bevel+facet)*.8,0,1)
    a=np.uint8(reflection*255)
    rgba=np.zeros((H,W,4),dtype=np.uint8);rgba[:,:,:3]=[199,224,255];rgba[:,:,3]=a
    Image.fromarray(rgba).save(assets/'glass-reflection.png')
    rgba[:,:,:3]=0;rgba[:,:,3]=np.uint8(np.clip(seam,0,1)*255)
    Image.fromarray(rgba).save(assets/'glass-dark-seam.png')
    Image.fromarray(np.uint8(lens*255)).save(assets/'rigid-shard-mask.png')
    save_trace(assets)
    for i,(x,y,mask) in enumerate(GLYPHS):
        rgba=np.zeros((*mask.shape,4),dtype=np.uint8)
        rgba[:,:,:3]=[255,9,27] if i==6 else [232,246,255]
        rgba[:,:,3]=np.uint8(mask*255)
        Image.fromarray(rgba).save(assets/f'glyph-{i}.png')
    (assets/'layout.json').write_text(json.dumps({'canvas':[W,H],'glyph_origins':[[x,y] for x,y,_ in GLYPHS],
        'note':'Source layers for a native compositing prototype. Reference-traced fracture; region offsets are rigid, with no curved lens distortion. Native playback remains to be implemented.'},indent=2))


def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=ROOT/'docs/local/intro/v5')
    p.add_argument('--stills',action='store_true');p.add_argument('--render',action='store_true')
    p.add_argument('--audio',type=Path);args=p.parse_args()
    output=args.output.resolve()
    if output in [ROOT/'docs/local/intro/render',ROOT/'docs/local/intro/v2',ROOT/'docs/local/intro/v3',ROOT/'docs/local/intro/v4']:
        raise ValueError('Preserved output directory; choose v5 or a new directory.')
    output.mkdir(parents=True,exist_ok=True);save_layers(output)
    if args.stills:
        for t in [.55,1.15,1.9,2.45,2.85,3.15,4.12,4.38,5.5,8.2,8.9,9.45,9.6]:
            Image.fromarray(render(t)).save(output/f'still-{round(t*100):04d}.png')
    if args.render:
        sound=args.audio or output/'studiox-reference-soundtrack.wav'
        if not sound.exists():raise FileNotFoundError('Run retime_audio_v5.py or supply --audio; v4 impact is at the wrong time.')
        destination=output/'studiox-reference-soundtrack.wav'
        if sound.resolve()!=destination.resolve():shutil.copyfile(sound,destination)
        sound=destination
        cmd=['ffmpeg','-v','warning','-y','-f','rawvideo','-pixel_format','rgb24',
             '-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','-', '-i',str(output/sound.name),
             '-c:v','libx264','-preset','medium','-crf','16','-threads','2','-pix_fmt','yuv420p',
             '-force_key_frames','0,9.7','-c:a','aac','-b:a','256k','-t','10','-movflags','+faststart',
             str(output/'studiox-intro-v5-60fps.mp4')]
        proof=output/'motion-samples';proof.mkdir(exist_ok=True)
        frames=output/'frames';frames.mkdir(exist_ok=True)
        # Each checkpoint is keyed to the renderer source and canvas/frame-rate.
        import hashlib
        identity=hashlib.sha256(Path(__file__).read_bytes()+PLATE_PATH.read_bytes()+
            b''.join((ASSETS/f'glyph-{i}.png').read_bytes() for i in range(7))+
            (ASSETS/'layout.json').read_bytes()).hexdigest()
        identity_file=frames/'source.sha256'
        if identity_file.exists() and identity_file.read_text()!=identity:
            raise RuntimeError('Frame source changed; choose a fresh output directory or clear only its frame cache.')
        identity_file.write_text(identity)
        process=subprocess.Popen(cmd,stdin=subprocess.PIPE)
        for f in range(600):
            t=f/FPS
            destination=frames/f'{f:04d}.png'
            if destination.exists():
                image=np.asarray(Image.open(destination).convert('RGB'))
            else:
                # Temporal samples around fracture/tremor, not duplicated video frames.
                if .28<=t<=3.05 or 3.45<=t<=4.75:
                    a=render(t);b=render(t+1/(FPS*3))
                    image=np.uint8((a.astype(np.float32)+b)*.5+.5)
                else:image=render(t)
                temporary=destination.with_suffix('.part.png')
                Image.fromarray(image).save(temporary)
                temporary.replace(destination)
            process.stdin.write(image.tobytes())
            if f in range(18,186,3) or f in range(207,288,3) or f in range(435,585,3):
                Image.fromarray(image).resize((480,270)).save(proof/f'{f:04d}.png')
            if f%30==0:print(f'V5_FRAME {f}/600',flush=True)
        process.stdin.close()
        if process.wait()!=0:raise RuntimeError('FFmpeg encoding failed')
        subprocess.run(['ffmpeg','-v','warning','-y','-i',str(output/'studiox-intro-v5-60fps.mp4'),
                        '-an','-c:v','copy',str(output/'studiox-intro-v5-silent.mp4')],check=True)
        print('V5 complete',flush=True)


if __name__=='__main__':main()
