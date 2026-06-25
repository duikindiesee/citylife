import bpy
from pathlib import Path

# Deterministic Rally Venue bench prop for CityLife.
# Placement is intentionally NOT encoded here; CityLife code places instances from city coords.

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()


def mat(name, color, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    if emission is not None:
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Emission Color'].default_value = emission
            bsdf.inputs['Emission Strength'].default_value = strength
    return m


wood = mat('public_safe_rally_bench_warm_wood', (0.42, 0.24, 0.10, 1.0))
metal = mat('public_safe_rally_bench_dark_metal', (0.06, 0.06, 0.07, 1.0))
emissive = mat(
    'public_safe_rally_bench_night_emissive_floor',
    (1.0, 0.72, 0.25, 1.0),
    (1.0, 0.72, 0.25, 1.0),
    0.8,
)


def cube(name, loc, scale, material):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


cube('rally_venue_bench_seat_lowpoly', (0, 0, 0.55), (2.0, 0.55, 0.16), wood)
cube('rally_venue_bench_back_lowpoly', (0, 0.33, 1.05), (2.0, 0.14, 0.75), wood)
for x in (-0.78, 0.78):
    for y in (-0.18, 0.18):
        cube('rally_venue_bench_leg_lowpoly', (x, y, 0.25), (0.12, 0.12, 0.5), metal)

# Night-readability proof: a small emissive floor strip under/near lit venue props.
cube('rally_venue_bench_floor_emissive_dot', (0, -0.62, 0.015), (0.45, 0.08, 0.03), emissive)

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
