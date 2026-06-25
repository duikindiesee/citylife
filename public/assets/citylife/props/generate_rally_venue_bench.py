import math
from pathlib import Path

import bpy

# Deterministic Rally Venue bench prop for CityLife.
# Placement is intentionally NOT encoded here; CityLife code places instances from city coords.
# The backrest is a locked ladder-frame: three slats pass into side holders with clamp pads.

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()


def mat(name, color, emission=None, strength=0.0, roughness=0.78):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Roughness'].default_value = roughness
        if emission is not None:
            bsdf.inputs['Emission Color'].default_value = emission
            bsdf.inputs['Emission Strength'].default_value = strength
    return m


wood = mat(
    'public_safe_rally_bench_warm_cape_oak',
    (0.60, 0.32, 0.13, 1.0),
    (0.12, 0.052, 0.015, 1.0),
    0.10,
)
post_wood = mat(
    'public_safe_rally_bench_dark_oak_holder',
    (0.23, 0.115, 0.045, 1.0),
    (0.07, 0.030, 0.010, 1.0),
    0.08,
)
metal = mat('public_safe_rally_bench_graphite_frame', (0.045, 0.05, 0.055, 1.0))
accent = mat(
    'public_safe_rally_bench_gold_badge',
    (0.98, 0.52, 0.14, 1.0),
    (0.98, 0.44, 0.10, 1.0),
    0.16,
)
emissive = mat(
    'public_safe_rally_bench_night_emissive_floor',
    (1.0, 0.58, 0.16, 1.0),
    (1.0, 0.50, 0.12, 1.0),
    0.85,
)


def cube(name, loc, scale, material, rot=(0.0, 0.0, 0.0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if bevel:
        bevel_mod = obj.modifiers.new(name='soft_lowpoly_bevel', type='BEVEL')
        bevel_mod.width = bevel
        bevel_mod.segments = 2
        bevel_mod.affect = 'EDGES'
        obj.modifiers.new(name='weighted_normals', type='WEIGHTED_NORMAL')
    return obj


def cylinder(name, loc, radius, depth, material, rot=(0.0, 0.0, 0.0), vertices=18):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=loc,
        rotation=rot,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    obj.modifiers.new(name='weighted_normals', type='WEIGHTED_NORMAL')
    return obj


seat_pitch = math.radians(-2.5)
back_pitch = math.radians(-10.0)
back_y = 0.455

# Seat: three open, flat slats with a low graphite support frame.
for name, y, z in (
    ('rally_venue_bench_seat_slat_front', -0.42, 0.535),
    ('rally_venue_bench_seat_slat_middle', -0.20, 0.555),
    ('rally_venue_bench_seat_slat_rear', 0.02, 0.575),
):
    cube(name, (0, y, z), (2.55, 0.125, 0.070), wood, (seat_pitch, 0, 0), 0.024)

# Backrest: slats penetrate the side holders so the end geometry visibly locks together.
back_slats = (
    ('rally_venue_bench_backrest_slat_bottom', 0.84),
    ('rally_venue_bench_backrest_slat_middle', 1.07),
    ('rally_venue_bench_backrest_slat_top', 1.30),
)
for name, z in back_slats:
    cube(name, (0, back_y, z), (2.72, 0.115, 0.085), wood, (back_pitch, 0, 0), 0.024)

for holder_name, x in (
    ('rally_venue_bench_backrest_left_holder', -1.30),
    ('rally_venue_bench_backrest_right_holder', 1.30),
):
    cube(holder_name, (x, back_y, 1.07), (0.17, 0.17, 0.72), post_wood, (back_pitch, 0, 0), 0.018)
    for _, z in back_slats:
        cube(
            'rally_venue_bench_backrest_clamp_pad',
            (x, back_y - 0.095, z),
            (0.21, 0.035, 0.125),
            post_wood,
            (back_pitch, 0, 0),
            0.012,
        )
        cylinder(
            'rally_venue_bench_backrest_bolt_cap',
            (x, back_y - 0.120, z),
            0.018,
            0.010,
            metal,
            (math.radians(90), 0, 0),
            12,
        )
    cube(
        'rally_venue_bench_backrest_downstand',
        (x, 0.31, 0.70),
        (0.105, 0.080, 0.28),
        post_wood,
        (math.radians(-6.0), 0, 0),
        0.014,
    )

# Low graphite support frame and legs.
for x, side in ((-1.08, -1), (1.08, 1)):
    cube(
        'rally_venue_bench_front_leg_graphite',
        (x, -0.47, 0.27),
        (0.095, 0.095, 0.54),
        metal,
        (0, 0, math.radians(-3 * side)),
        0.023,
    )
    cube(
        'rally_venue_bench_rear_leg_graphite',
        (x, 0.26, 0.37),
        (0.095, 0.095, 0.74),
        metal,
        (math.radians(-8), 0, math.radians(3 * side)),
        0.023,
    )
    cube(
        'rally_venue_bench_low_side_runner_graphite',
        (x, -0.10, 0.36),
        (0.080, 0.78, 0.055),
        metal,
        (math.radians(-2), 0, 0),
        0.018,
    )
    cube(
        'rally_venue_bench_short_back_brace_graphite',
        (x, 0.34, 0.73),
        (0.075, 0.35, 0.055),
        metal,
        (math.radians(-18), 0, 0),
        0.018,
    )

cube('rally_venue_bench_front_underseat_crossbar', (0, -0.49, 0.405), (2.18, 0.055, 0.060), metal, bevel=0.016)
cube('rally_venue_bench_rear_underseat_crossbar', (0, 0.12, 0.425), (2.18, 0.055, 0.060), metal, bevel=0.016)
cube('rally_venue_bench_back_lower_support_crossbar', (0, 0.34, 0.705), (2.18, 0.050, 0.055), metal, (back_pitch, 0, 0), 0.014)

# Small public-safe rally accent and night-readability glow.
cube('rally_venue_bench_badge_front_mount_plate', (0, -0.522, 0.575), (0.34, 0.026, 0.145), metal, bevel=0.012)
cylinder('rally_venue_bench_public_safe_badge', (0, -0.540, 0.575), 0.095, 0.018, accent, (math.radians(90), 0, 0), 24)
cube('rally_venue_bench_badge_center_dash', (0, -0.554, 0.575), (0.102, 0.012, 0.022), metal, bevel=0.004)
cube('rally_venue_bench_underseat_glow_strip', (0, -0.20, 0.462), (1.75, 0.032, 0.028), emissive, bevel=0.010)
cube('rally_venue_bench_floor_emissive_dot', (0, -0.20, 0.018), (0.76, 0.035, 0.014), emissive, bevel=0.008)

out = Path(__file__).with_name('rally-venue-bench.glb')
bpy.ops.export_scene.gltf(
    filepath=str(out),
    export_format='GLB',
    export_apply=True,
    export_yup=True,
    export_materials='EXPORT',
)
print(f'EXPORTED_GLB={out}')
print(f'BYTE_SIZE={out.stat().st_size}')
