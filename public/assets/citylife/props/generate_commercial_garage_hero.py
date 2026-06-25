from pathlib import Path
import math
import bpy

OUT = Path(__file__).with_name("commercial-garage-hero.glb")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()


def mat(name, base, roughness=0.55, metallic=0.0, alpha=1.0, emission=None, strength=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = base
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = base
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Alpha"].default_value = alpha
        if emission:
            bsdf.inputs["Emission Color"].default_value = emission
            bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        material.blend_method = "BLEND"
        material.use_screen_refraction = True
        material.show_transparent_back = True
    return material


warm_concrete = mat("commercial_garage_hero_warm_concrete", (0.34, 0.31, 0.27, 1.0))
dark_trim = mat("commercial_garage_hero_graphite_trim", (0.04, 0.05, 0.055, 1.0), roughness=0.38, metallic=0.15)
charcoal = mat("commercial_garage_hero_charcoal_roof", (0.025, 0.028, 0.032, 1.0), roughness=0.42, metallic=0.08)
rollup = mat("commercial_garage_hero_rollup_brushed_door", (0.60, 0.58, 0.52, 1.0), roughness=0.48, metallic=0.25)
glass = mat(
    "commercial_garage_hero_warm_glass",
    (0.58, 0.88, 1.0, 0.26),
    roughness=0.06,
    metallic=0.0,
    alpha=0.26,
    emission=(1.0, 0.62, 0.24, 1.0),
    strength=0.28,
)
warm_glow = mat(
    "commercial_garage_hero_warm_night_emissive",
    (1.0, 0.55, 0.16, 1.0),
    roughness=0.22,
    emission=(1.0, 0.48, 0.12, 1.0),
    strength=1.9,
)
cyan_glow = mat(
    "commercial_garage_hero_cool_edge_glow",
    (0.15, 0.85, 1.0, 1.0),
    roughness=0.2,
    emission=(0.04, 0.72, 1.0, 1.0),
    strength=1.25,
)
paint_orange = mat("commercial_garage_hero_display_car_orange", (0.95, 0.28, 0.08, 1.0), roughness=0.34)
paint_teal = mat("commercial_garage_hero_display_car_teal", (0.02, 0.52, 0.62, 1.0), roughness=0.34)
paint_white = mat("commercial_garage_hero_showroom_car_pearl", (0.88, 0.86, 0.76, 1.0), roughness=0.26)
rubber = mat("commercial_garage_hero_tire_rubber", (0.01, 0.01, 0.012, 1.0), roughness=0.7)


def cube(name, loc, scale, material, rot=(0.0, 0.0, 0.0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new(name="soft_low_poly_edges", type="BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        modifier.affect = "EDGES"
        obj.modifiers.new(name="weighted_vertex_normals", type="WEIGHTED_NORMAL")
    return obj


def cyl(name, loc, radius, depth, material, rot=(0.0, 0.0, 0.0), vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    obj.modifiers.new(name="weighted_vertex_normals", type="WEIGHTED_NORMAL")
    return obj


def make_car(prefix, loc, yaw, material, glowing=False):
    x, y, z = loc
    body_mat = warm_glow if glowing else material
    cube(f"{prefix}_body", (x, y, z + 0.25), (1.38, 0.72, 0.32), body_mat, rot=(0, 0, yaw), bevel=0.055)
    cube(f"{prefix}_cabin", (x + math.cos(yaw) * 0.10, y + math.sin(yaw) * 0.10, z + 0.53), (0.64, 0.58, 0.30), glass, rot=(0, 0, yaw), bevel=0.045)
    cube(f"{prefix}_front_glow", (x + math.cos(yaw) * 0.67, y + math.sin(yaw) * 0.67, z + 0.33), (0.10, 0.66, 0.10), cyan_glow, rot=(0, 0, yaw), bevel=0.02)
    for idx, lx in enumerate((-0.44, 0.44)):
        for side, ly in enumerate((-0.42, 0.42)):
            wx = x + math.cos(yaw) * lx - math.sin(yaw) * ly
            wy = y + math.sin(yaw) * lx + math.cos(yaw) * ly
            cyl(f"{prefix}_wheel_{idx}_{side}", (wx, wy, z + 0.16), 0.13, 0.10, rubber, rot=(math.pi / 2, 0, yaw), vertices=10)


# footprint and street-facing forecourt
cube("commercial_garage_hero_forecourt_lane", (0.0, -1.85, 0.015), (8.7, 3.1, 0.03), warm_concrete, bevel=0.025)
cube("commercial_garage_hero_forecourt_lane_center_glow", (0.0, -1.85, 0.045), (7.4, 0.075, 0.035), warm_glow, bevel=0.018)
cube("commercial_garage_hero_showroom_plinth", (-2.05, 1.25, 0.09), (3.25, 2.75, 0.18), warm_concrete, bevel=0.055)
cube("commercial_garage_hero_service_plinth", (1.75, 1.05, 0.075), (3.95, 2.45, 0.15), warm_concrete, bevel=0.045)

# glass showroom cube with warm car silhouette inside
cube("commercial_garage_hero_showroom_glass_cube", (-2.05, 1.25, 1.05), (2.95, 2.35, 1.9), glass, bevel=0.035)
cube("commercial_garage_hero_showroom_dark_floor", (-2.05, 1.25, 0.26), (2.72, 2.12, 0.12), dark_trim, bevel=0.02)
cube("commercial_garage_hero_showroom_roof_cap", (-2.05, 1.25, 2.09), (3.12, 2.52, 0.22), charcoal, bevel=0.045)
for sx in (-3.58, -0.52):
    cube(f"commercial_garage_hero_showroom_corner_post_{sx:+.1f}", (sx, 0.0, 1.12), (0.12, 0.14, 1.88), dark_trim, bevel=0.015)
    cube(f"commercial_garage_hero_showroom_corner_post_back_{sx:+.1f}", (sx, 2.5, 1.12), (0.12, 0.14, 1.88), dark_trim, bevel=0.015)
for z in (0.46, 1.98):
    cube(f"commercial_garage_hero_showroom_horizontal_frame_{z:.1f}", (-2.05, -0.01, z), (3.16, 0.12, 0.12), dark_trim, bevel=0.012)
    cube(f"commercial_garage_hero_showroom_back_frame_{z:.1f}", (-2.05, 2.51, z), (3.16, 0.12, 0.12), dark_trim, bevel=0.012)
make_car("commercial_garage_hero_showroom_car_glow", (-2.08, 1.05, 0.36), math.radians(18), paint_white, glowing=True)

# lower service bay shed with roll-up doors
cube("commercial_garage_hero_service_bay_shed", (1.75, 1.08, 0.98), (3.65, 2.15, 1.45), dark_trim, bevel=0.04)
cube("commercial_garage_hero_service_bay_roof", (1.75, 1.08, 1.78), (3.92, 2.38, 0.28), charcoal, bevel=0.05)
for x, door_name in (
    (0.92, "commercial_garage_hero_rollup_door_left"),
    (2.58, "commercial_garage_hero_rollup_door_right"),
):
    cube(door_name, (x, -0.03, 0.84), (1.32, 0.10, 1.02), rollup, bevel=0.025)
    for stripe in range(5):
        cube(f"{door_name}_rib_{stripe}", (x, -0.095, 0.43 + stripe * 0.18), (1.24, 0.035, 0.025), dark_trim, bevel=0.006)
cube("commercial_garage_hero_service_bay_warm_interior", (1.75, -0.105, 1.22), (3.22, 0.045, 0.16), warm_glow, bevel=0.01)
cube("commercial_garage_hero_service_bay_forecourt_threshold", (1.75, -0.42, 0.09), (3.4, 0.48, 0.08), warm_glow, bevel=0.018)

# pylon sign: tallest vertical, abstract public-safe marker
cube("commercial_garage_hero_corner_pylon_sign", (4.15, -0.1, 2.35), (0.38, 0.38, 4.65), dark_trim, bevel=0.04)
cube("commercial_garage_hero_corner_pylon_top_panel", (4.15, -0.1, 4.78), (1.08, 0.44, 1.05), warm_glow, bevel=0.055)
cube("commercial_garage_hero_corner_pylon_cool_edge_left", (3.55, -0.1, 4.78), (0.08, 0.48, 1.17), cyan_glow, bevel=0.015)
cube("commercial_garage_hero_corner_pylon_cool_edge_right", (4.75, -0.1, 4.78), (0.08, 0.48, 1.17), cyan_glow, bevel=0.015)
cube("commercial_garage_hero_corner_pylon_base_glow", (4.15, -0.1, 0.17), (0.92, 0.92, 0.18), warm_glow, bevel=0.045)

# display cars angled toward road and showroom
make_car("commercial_garage_hero_display_car_angle_left", (-1.65, -2.6, 0.08), math.radians(-18), paint_orange, glowing=False)
make_car("commercial_garage_hero_display_car_angle_right", (1.55, -2.68, 0.08), math.radians(20), paint_teal, glowing=False)
cube("commercial_garage_hero_display_car_underlight_left", (-1.65, -2.6, 0.06), (1.56, 0.86, 0.035), cyan_glow, rot=(0, 0, math.radians(-18)), bevel=0.02)
cube("commercial_garage_hero_display_car_underlight_right", (1.55, -2.68, 0.06), (1.56, 0.86, 0.035), warm_glow, rot=(0, 0, math.radians(20)), bevel=0.02)

# rooftop wrench emblem, abstract tool silhouette
cube("commercial_garage_hero_rooftop_wrench_emblem", (1.75, 1.05, 2.16), (1.46, 0.16, 0.13), warm_glow, rot=(0, 0, math.radians(28)), bevel=0.026)
cube("commercial_garage_hero_rooftop_wrench_jaw_upper", (2.36, 1.38, 2.18), (0.44, 0.13, 0.13), warm_glow, rot=(0, 0, math.radians(68)), bevel=0.018)
cube("commercial_garage_hero_rooftop_wrench_jaw_lower", (2.39, 1.12, 2.18), (0.44, 0.13, 0.13), warm_glow, rot=(0, 0, math.radians(-14)), bevel=0.018)
cyl("commercial_garage_hero_rooftop_wrench_handle_round", (1.08, 0.69, 2.18), 0.21, 0.09, warm_glow, rot=(math.pi / 2, 0, 0), vertices=12)
cube("commercial_garage_hero_rooftop_wrench_cross_handle", (1.73, 1.06, 2.235), (1.05, 0.105, 0.105), cyan_glow, rot=(0, 0, math.radians(-28)), bevel=0.02)

# low guard rails and light dots shape the forecourt but remain drivable-looking
for x in (-3.55, -2.35, -0.75, 0.75, 2.35, 3.55):
    cube(f"commercial_garage_hero_forecourt_warm_marker_{x:+.1f}", (x, -3.48, 0.12), (0.22, 0.08, 0.16), warm_glow, bevel=0.02)
for x in (-3.65, 3.65):
    cube(f"commercial_garage_hero_forecourt_low_guard_{x:+.1f}", (x, -1.85, 0.34), (0.12, 2.75, 0.28), dark_trim, bevel=0.02)

# origin anchor keeps the reusable shell centered for future CityLife code-owned transforms
cube("commercial_garage_hero_asset_origin_marker_hidden_underfloor", (0.0, 0.0, -0.035), (0.18, 0.18, 0.03), dark_trim, bevel=0.0)

bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
bpy.context.object.name = "commercial_garage_hero_root"

bpy.ops.wm.save_as_mainfile(filepath=str(OUT.with_suffix(".blend")))
bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
)
print(f"WROTE={OUT}")
