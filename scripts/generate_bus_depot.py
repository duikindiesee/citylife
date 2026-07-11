#!/usr/bin/env python3
"""Generate CityLife's deterministic 48 x 28 metre bus depot GLB."""
from pathlib import Path
import bpy
import math

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/citylife/props/bus-depot.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, roughness=0.65, metallic=0.0, emission=None, strength=0.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return material


ASPHALT = mat("apron", (0.10, 0.115, 0.12))
PAINT = mat("bay_paint", (0.92, 0.72, 0.12), roughness=0.5)
WHITE = mat("marking_white", (0.92, 0.94, 0.92), roughness=0.5)
WALL = mat("office_wall", (0.42, 0.56, 0.59))
ROOF = mat("roof", (0.08, 0.12, 0.15), metallic=0.15)
GLASS = mat("glass", (0.10, 0.30, 0.38), roughness=0.2, metallic=0.1)
STEEL = mat("shelter_steel", (0.12, 0.18, 0.21), metallic=0.5, roughness=0.35)
BENCH = mat("bench", (0.70, 0.31, 0.12))
SIGN = mat("sign", (0.08, 0.32, 0.48), roughness=0.3, emission=(0.10, 0.75, 1.0), strength=4.0)


def cube(name, location, scale, material, bevel=0.0):
    # Author in glTF coordinates (X, Y-up, Z); Blender stores them as (X, -Z, Y).
    x, y, z = location
    sx, sy, sz = scale
    bpy.ops.mesh.primitive_cube_add(location=(x, -z, y))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (sx, sz, sy)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("soft_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.materials.append(material)
    return obj


def join(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    parts[0].name = name
    return parts[0]


def text_mesh(text, name, location, size, material, rotation=(0, 0, 0), extrude=0.006):
    x, y, z = location
    bpy.ops.object.text_add(location=(x, -z, y), rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = extrude
    obj.data.materials.append(material)
    bpy.ops.object.convert(target="MESH")
    return bpy.context.object


root = bpy.data.objects.new("Bus_Depot", None)
bpy.context.collection.objects.link(root)

# The complete pad is one thin slab; its top is y=0.04, below the 0.05 m drive-path cap.
apron_parts = [cube("apron_base", (0, 0.02, 0), (48, 0.04, 28), ASPHALT)]
# Gate lane arrows point inward from the +X gate edge and stay flush with the apron.
for x in (20.0, 12.0, 4.0):
    apron_parts.append(cube("lane_arrow_stem", (x, 0.045, 0), (2.6, 0.006, 0.20), WHITE))
    left = cube("lane_arrow_left", (x - 1.35, 0.045, -0.34), (1.05, 0.006, 0.20), WHITE)
    left.rotation_euler.z = math.radians(35)
    bpy.context.view_layer.objects.active = left
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    right = cube("lane_arrow_right", (x - 1.35, 0.045, 0.34), (1.05, 0.006, 0.20), WHITE)
    right.rotation_euler.z = math.radians(-35)
    bpy.context.view_layer.objects.active = right
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    apron_parts.extend((left, right))
apron = join(apron_parts, "Depot_Apron")
apron.parent = root

# Ten 4 x 13 m open painted bays. Packing is across the 48 m long edge so all ten fit.
# Each contract mesh contains only flush paint strips and its number, never a raised obstacle.
for index in range(10):
    cx = -21.0 + index * (42.0 / 9.0)
    cz = -7.5
    parts = [
        cube("bay_left", (cx - 1.96, 0.048, cz), (0.08, 0.004, 13.0), PAINT),
        cube("bay_right", (cx + 1.96, 0.048, cz), (0.08, 0.004, 13.0), PAINT),
        cube("bay_back", (cx, 0.048, cz - 6.46), (4.0, 0.004, 0.08), PAINT),
    ]
    parts.append(text_mesh(str(index + 1), "bay_number", (cx, 0.044, cz - 5.7), 0.72, PAINT, extrude=0.003))
    bay = join(parts, f"Depot_Bay_{index:02d}")
    bay.parent = root

# Compact office at the gate-side corner, clear of the approach lane.
office_parts = [
    cube("office_body", (20.0, 1.75, 10.5), (6.0, 3.5, 4.0), WALL, 0.12),
    cube("office_roof", (20.0, 3.58, 10.5), (6.5, 0.18, 4.5), ROOF, 0.08),
    cube("office_window", (16.96, 2.0, 10.5), (0.04, 1.35, 2.2), GLASS),
    cube("office_door", (20.0, 1.15, 8.48), (1.15, 2.3, 0.04), ROOF),
]
office = join(office_parts, "Depot_Office")
office.parent = root

# Boarding shelter: slim posts, canopy, bench and route board beside the gate lane.
shelter_parts = [
    cube("shelter_post_a", (17.2, 1.35, 6.0), (0.12, 2.7, 0.12), STEEL),
    cube("shelter_post_b", (22.8, 1.35, 6.0), (0.12, 2.7, 0.12), STEEL),
    cube("shelter_post_c", (17.2, 1.35, 8.2), (0.12, 2.7, 0.12), STEEL),
    cube("shelter_post_d", (22.8, 1.35, 8.2), (0.12, 2.7, 0.12), STEEL),
    cube("shelter_canopy", (20.0, 2.75, 7.1), (6.0, 0.16, 2.5), ROOF, 0.06),
    cube("shelter_back", (20.0, 1.45, 8.22), (5.6, 2.25, 0.05), GLASS),
    cube("bench_seat", (20.0, 0.62, 7.65), (3.8, 0.16, 0.55), BENCH, 0.05),
    cube("bench_back", (20.0, 1.02, 7.92), (3.8, 0.72, 0.12), BENCH, 0.05),
    cube("route_board", (22.25, 1.55, 8.05), (0.75, 1.25, 0.08), SIGN, 0.03),
]
shelter = join(shelter_parts, "Depot_Shelter")
shelter.parent = root

# Emissive BUS totem: its mesh carries the exact material slot name `sign`.
sign_parts = [
    cube("sign_post", (23.0, 1.5, 4.3), (0.16, 3.0, 0.16), STEEL),
    cube("sign_panel", (23.0, 3.35, 4.3), (1.7, 0.95, 0.18), SIGN, 0.08),
    text_mesh("BUS", "sign_letters", (23.0, 3.35, 4.19), 0.43, SIGN, rotation=(math.pi / 2, 0, 0), extrude=0.012),
]
sign = join(sign_parts, "Depot_Sign")
sign.parent = root

# Stable transforms and no export-only scene objects.
for obj in bpy.context.scene.objects:
    obj.select_set(False)
if bpy.context.scene.camera:
    bpy.data.objects.remove(bpy.context.scene.camera, do_unlink=True)
for obj in list(bpy.data.objects):
    if obj.type == "LIGHT" or obj.type == "CAMERA":
        bpy.data.objects.remove(obj, do_unlink=True)

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
)
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
