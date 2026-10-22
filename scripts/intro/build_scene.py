"""Build the editable StudioX 10-second title scene. Run with Blender 5.x."""
import argparse
import math
import random
import shutil
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
FPS = 30
DURATION = 10
IMPACT = 5.43
SETTLED = 3.45
RNG = random.Random(2206)


def frame(seconds):
    return round(seconds * FPS) + 1


def key(obj, prop, seconds, value):
    setattr(obj, prop, value)
    obj.keyframe_insert(data_path=prop, frame=frame(seconds))


def material(name, color, strengths):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = (*color, 1)
    output = nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(emission.outputs[0], output.inputs['Surface'])
    for seconds, strength in strengths:
        emission.inputs['Strength'].default_value = strength
        emission.inputs['Strength'].keyframe_insert('default_value', frame=frame(seconds))
    return mat


def mesh_object(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def split_mesh(mesh, center, low, high, slope=0.34):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    normal = Vector((slope, 1, 0))
    for boundary, remove_low in ((low, True), (high, False)):
        if boundary is None:
            continue
        # Geometry is in world XY until clipping is complete.
        bmesh.ops.bisect_plane(
            bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
            plane_co=(0, boundary, 0), plane_no=normal, dist=0.00001,
            clear_inner=remove_low, clear_outer=not remove_low,
        )
    if not bm.faces:
        bm.free()
        return None
    for vertex in bm.verts:
        vertex.co -= center
    result = bpy.data.meshes.new('Fractured glyph')
    bm.to_mesh(result)
    bm.free()
    return result


def title(font):
    word = 'STUDIOX'
    glyphs = []
    cursor = 0
    for i, letter in enumerate(word):
        curve = bpy.data.curves.new('Letter ' + letter, 'FONT')
        curve.body = letter
        curve.font = font
        curve.size = 1.40
        curve.resolution_u = 16
        obj = bpy.data.objects.new('Source ' + letter, curve)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.update()
        glyphs.append(obj)
        obj.location.x = cursor
        cursor += obj.dimensions.x + 0.055
    width = cursor - 0.055
    brightness = [
        (0, 0), (0.34, 0), (0.40, 0.26), (0.52, 0.08),
        (0.64, 0.42), (0.72, 0.21), (1.1, 0.48),
        (1.43, 0.22), (1.53, 0.55), (2.05, 0.48),
        (2.16, 0.2), (2.23, 0.60), (2.9, 0.67),
        (SETTLED, 0.76), (IMPACT - 0.02, 0.76),
        (IMPACT + 0.04, 0.95), (IMPACT + 0.12, 0.69),
        (IMPACT + 0.34, 0.76), (8.3, 0.73),
        (8.65, 0.55), (9.15, 0.23), (9.7, 0), (10, 0),
    ]
    white = material('Title — cool white', (0.83, 0.91, 1.0), brightness)
    red = material('Title — crimson X', (0.80, 0.018, 0.038), brightness)
    for i, obj in enumerate(glyphs):
        obj.location.x -= width / 2
        obj.location.y = -0.50
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.convert(target='MESH')
        obj.select_set(False)
        # Bake world coordinates for a continuous screen-wide fracture.
        for v in obj.data.vertices:
            v.co = obj.matrix_world @ v.co
        obj.matrix_world.identity()
        xs = [v.co.x for v in obj.data.vertices]
        ys = [v.co.y for v in obj.data.vertices]
        center = Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, 0))
        parent = bpy.data.objects.new('Reveal ' + word[i] + str(i), None)
        bpy.context.collection.objects.link(parent)
        parent.location = center
        for t, spread in [(0, .18), (.65, .25), (1.45, .46),
                          (2.25, .74), (3.05, .96), (SETTLED, 1)]:
            key(parent, 'location', t, (center.x * spread, center.y, 0))
        # Edge-on, reflected glyph fragments resolve into the final word.
        phase = abs(i - 3) * 0.075
        for t, scale in [
            (0, (0.12, 0.001, 1)),
            (0.36 + phase, (0.22, 0.025, 1)),
            (0.65 + phase, (-0.33, 0.16, 1)),
            (1.05 + phase, (0.32, -0.23, 1)),
            (1.45 + phase, (-0.54, 0.35, 1)),
            (1.85 + phase, (0.46, -0.55, 1)),
            (2.18 + phase, (-0.85, 0.79, 1)),
            (2.5 + phase, (0.98, -0.96, 1)),
            (2.85 + phase, (1.0, 0.88, 1)),
            (3.22 + phase, (1, 1, 1)),
        ]:
            key(parent, 'scale', t, scale)
        for region, bounds in enumerate(((None, -0.025), (-0.025, 0.025), (0.025, None))):
            mesh = split_mesh(obj.data, center, *bounds)
            if mesh is None:
                continue
            shard = bpy.data.objects.new('Title fragment %s %d' % (word[i], region), mesh)
            bpy.context.collection.objects.link(shard)
            shard.parent = parent
            shard.data.materials.clear()
            shard.data.materials.append(red if i == len(word) - 1 else white)
            key(shard, 'hide_render', 0, True)
            key(shard, 'hide_render', IMPACT, False)
            sign = -1 if region == 0 else 1
            dx, dy = (sign * 0.035, sign * 0.016)
            if region == 1:
                dx, dy = 0.12, -0.055
            key(shard, 'location', 0, (0, 0, 0))
            key(shard, 'location', IMPACT - 0.01, (0, 0, 0))
            key(shard, 'location', IMPACT + 0.08, (dx * 2, dy * 2, 0))
            key(shard, 'location', IMPACT + 0.23, (dx, dy, 0))
            key(shard, 'location', 10, (dx, dy, 0))
            key(shard, 'rotation_euler', IMPACT - 0.01, (0, 0, 0))
            key(shard, 'rotation_euler', IMPACT + 0.15, (0, 0, sign * 0.0035))
        # An uncut source prevents subpixel bisect seams during the clean hold.
        for vertex in obj.data.vertices:
            vertex.co -= center
        obj.parent = parent
        obj.location = (0, 0, 0)
        obj.data.materials.clear()
        obj.data.materials.append(red if i == len(word) - 1 else white)
        key(obj, 'hide_render', 0, False)
        key(obj, 'hide_render', IMPACT, True)


def crack_curve(name, points, radius, mat, start, end):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for p, coord in zip(spline.points, points):
        p.co = (*coord, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    key(obj, 'hide_render', 0, True)
    key(obj, 'hide_render', start, False)
    key(curve, 'bevel_factor_end', 0, 0)
    key(curve, 'bevel_factor_end', start, 0)
    key(curve, 'bevel_factor_end', end, 1)
    return obj


def glass():
    # A fracture through the glass plane, not an explosion or radial impact.
    # Points are ordered from bottom-right to top-left.
    points = []
    for i in range(75):
        x = 8.3 - i * 16.6 / 74
        y = -0.34 * x + RNG.uniform(-0.025, 0.025)
        if abs(x) < 1:
            y += 0.035 * math.sin(x * 12)
        points.append((x, y, 0.12))
    fade = [(0, 0), (IMPACT - 0.1, 0), (IMPACT, 1),
            (IMPACT + 0.15, 0.38), (IMPACT + 0.4, 0.25),
            (8.3, 0.25), (9.1, 0.08), (9.7, 0), (10, 0)]
    dark = material('Crack — shadow seam', (0, 0, 0), [(0, 1), (10, 1)])
    crack_curve('Continuous fracture shadow', points, 0.008, dark, IMPACT - 0.1, IMPACT + 0.08)
    # Alternating lit facets make an irregular glass edge, rather than a white line.
    for i in range(len(points) - 1):
        a, b = points[i:i+2]
        centrality = max(0.08, 1 - abs(a[0]) / 9)
        level = RNG.uniform(0.02, 0.17) * centrality
        mat = material('Fracture edge %02d' % i, (level, level * 1.08, level * 1.16), fade)
        upper = [(p[0], p[1] + 0.009, 0.15) for p in (a, b)]
        start = IMPACT - 0.1 + i / 74 * 0.17
        crack_curve('Glass edge %02d' % i, upper, RNG.uniform(0.0018, 0.0050),
                    mat, start, start + 0.018)
    # Thin branching fissures stay close to the primary diagonal.
    for i in range(30):
        origin = points[RNG.randrange(9, 66)]
        length = RNG.uniform(0.16, 1.5)
        direction = RNG.choice((-1, 1))
        branch = [origin]
        for j in range(1, 7):
            x = origin[0] - length * j / 6
            y = origin[1] + length * j / 6 * (0.34 + direction * RNG.uniform(0.1, 0.35))
            branch.append((x, y, 0.15))
        level = RNG.uniform(0.005, 0.065)
        mat = material('Hairline reflection %02d' % i, (level, level * 1.07, level * 1.12), fade)
        delay = (8.3 - origin[0]) / 16.6 * 0.17
        crack_curve('Hairline %02d' % i, branch, RNG.uniform(0.0010, 0.0024),
                    mat, IMPACT - 0.08 + delay, IMPACT + 0.16 + delay)
    # Narrow glass splinters with faint reflections around the central fracture.
    for i in range(11):
        x = RNG.uniform(-2, 2)
        y = -0.34 * x
        size = RNG.uniform(0.15, 0.55)
        vertices = [(x, y, 0.08), (x + size, y - size * .34, 0.08),
                    (x + size * .7, y - size * .34 - RNG.uniform(.015, .07), 0.08)]
        level = RNG.uniform(.0006, .002)
        mat = material('Glass facet %02d' % i, (level, level, level), fade)
        obj = mesh_object('Glass sliver %02d' % i, vertices, [(0, 1, 2)], mat)
        key(obj, 'hide_render', 0, True)
        key(obj, 'hide_render', IMPACT, False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default=str(ROOT / 'docs/local/intro/render'))
    parser.add_argument('--width', type=int, default=1920)
    parser.add_argument('--height', type=int, default=1080)
    parser.add_argument('--samples', type=int, default=24)
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--stills', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 1
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = FPS * DURATION
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = False
    scene.render.dither_intensity = 0
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0, 0, 0, 1)
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    camera_data = bpy.data.cameras.new('Title camera')
    camera = bpy.data.objects.new('Title camera', camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0, -0.15, 20)
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 16
    scene.camera = camera
    font_path = '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf'
    if not Path(font_path).exists():
        font_path = '/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf'
    title(bpy.data.fonts.load(font_path))
    glass()
    for name, t in [('Black', 0), ('Title fragments', .4), ('Stable title', SETTLED),
                    ('Glass impact', IMPACT), ('Fade', 8.3), ('Black end', 9.7)]:
        scene.timeline_markers.new(name, frame=frame(t))
    scene['reference_url'] = 'https://www.youtube.com/watch?v=pxjy1vahZnU'
    scene['title'] = 'StudioX'
    scene['duration_seconds'] = DURATION
    scene['audio_note'] = 'Third-party reference audio; muxed separately for the MP4.'
    soundtrack = output / 'studiox-reference-soundtrack.wav'
    if soundtrack.exists():
        editor = scene.sequence_editor_create()
        strip = editor.strips.new_sound('Retimed reference soundtrack', str(soundtrack),
                                        channel=1, frame_start=1)
        strip.sound.filepath = '//studiox-reference-soundtrack.wav'
        scene.sync_mode = 'AUDIO_SYNC'
    # Render the camera even when a soundtrack is present in the sequence editor.
    scene.render.use_sequencer = False
    scene.render.filepath = str(output / 'frames' / '')
    (output / 'frames').mkdir(exist_ok=True)
    scene.frame_set(frame(4.2))
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'studiox-intro.blend'))
    if args.stills:
        for t in [0, 1.3, 2.6, 4.2, 5.6, 7.2, 9.2, 9.9]:
            scene.frame_set(frame(t))
            scene.render.filepath = str(output / ('still-%04d.png' % round(t * 100)))
            bpy.ops.render.render(write_still=True)
    if args.render:
        cached = {}
        for f in range(scene.frame_start, scene.frame_end + 1):
            t = (f - 1) / FPS
            cache_key = 'black' if t < .34 or t >= 9.7 else (
                'clean_hold' if 3.5 <= t < 5.3 else None)
            destination = output / 'frames' / ('%04d.png' % f)
            if cache_key in cached:
                shutil.copyfile(cached[cache_key], destination)
            else:
                scene.frame_set(f)
                # Before impact all visible geometry is central. Render that
                # region into the full black canvas instead of tracing empty pixels.
                scene.render.use_border = t < IMPACT - .11
                scene.render.use_crop_to_border = False
                scene.render.border_min_x = .25
                scene.render.border_max_x = .75
                scene.render.border_min_y = .25
                scene.render.border_max_y = .75
                scene.render.filepath = str(destination)
                bpy.ops.render.render(write_still=True)
                if cache_key:
                    cached[cache_key] = destination
            print('STUDIOX_FRAME %d/%d' % (f, scene.frame_end), flush=True)


if __name__ == '__main__':
    main()
