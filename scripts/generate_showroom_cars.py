"""
Blender 5.2 headless script to generate high-fidelity 3D GLB assets for the CityLife Showroom:
- Karoo Vonk 1.1 (public/assets/citylife/cars/karoo_vonk.glb)
- Karoo Kaap GT-V8 (public/assets/citylife/cars/karoo_kaap_gt.glb)

Both models align with the Karoo Motors marque, comply with public safety rules, and share the
exact coordinate system and orientation (+Y forward, +Z up, +X right) as the yellow Karoo X19 Targa.
"""

import bpy
import math
import os
import sys

def create_pbr_material(name, color=(0.1, 0.1, 0.1, 1.0), metallic=0.0, roughness=0.5, clearcoat=0.0, transmission=0.0, emissive=(0, 0, 0, 1), emissive_strength=0.0, opacity=1.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        if "Base Color" in bsdf.inputs:
            bsdf.inputs["Base Color"].default_value = color
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = metallic
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = roughness
        if "Coat Weight" in bsdf.inputs:
            bsdf.inputs["Coat Weight"].default_value = clearcoat
        elif "Clearcoat" in bsdf.inputs:
            bsdf.inputs["Clearcoat"].default_value = clearcoat
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = transmission
        elif "Transmission" in bsdf.inputs:
            bsdf.inputs["Transmission"].default_value = transmission

        if opacity < 1.0:
            mat.blend_method = "BLEND"
            if "Alpha" in bsdf.inputs:
                bsdf.inputs["Alpha"].default_value = opacity

        if emissive_strength > 0:
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = emissive
            elif "Emission" in bsdf.inputs:
                bsdf.inputs["Emission"].default_value = emissive
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = emissive_strength
    return mat

def add_mesh_child(name, mesh_type, local_pos, scale, rot=(0, 0, 0), mat=None, bevel_width=0, parent=None, vertices=32):
    if mesh_type == 'cube':
        bpy.ops.mesh.primitive_cube_add(size=1.0)
    elif mesh_type == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=0.5, depth=1.0)
    elif mesh_type == 'uvsphere':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.5)

    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    obj.location = local_pos

    if mat:
        obj.data.materials.append(mat)

    if bevel_width > 0:
        b = obj.modifiers.new(name="Bevel", type='BEVEL')
        b.width = bevel_width
        b.segments = 3

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()

    if parent:
        obj.parent = parent
    return obj


# ==============================================================================
# 1. KAROO VONK 1.1 (Compact Starter Hatch)
# ==============================================================================
def build_karoo_vonk(output_path):
    print(f"Building Karoo Vonk 1.1 -> {output_path}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collection = bpy.context.collection

    # Materials
    mat_paint = create_pbr_material("CarPaint_KarooAzure", color=(0.18, 0.45, 0.88, 1.0), metallic=0.88, roughness=0.18, clearcoat=1.0)
    mat_white_roof = create_pbr_material("CarPaint_BiancoWhite", color=(0.94, 0.95, 0.97, 1.0), metallic=0.75, roughness=0.22, clearcoat=1.0)
    mat_chrome = create_pbr_material("Chrome_KarooClassic", color=(0.95, 0.95, 0.98, 1.0), metallic=0.98, roughness=0.04)
    mat_black_trim = create_pbr_material("BlackMatteTrim", color=(0.04, 0.04, 0.05, 1.0), metallic=0.2, roughness=0.6)
    mat_glass = create_pbr_material("Glass_KarooCanopy", color=(0.12, 0.18, 0.24, 1.0), metallic=0.08, roughness=0.04, transmission=0.88, opacity=0.35)
    mat_rim = create_pbr_material("AlloyRim_KarooIconic", color=(0.88, 0.9, 0.93, 1.0), metallic=0.95, roughness=0.12)
    mat_tire = create_pbr_material("TireRubber_Karoo", color=(0.05, 0.05, 0.05, 1.0), metallic=0.02, roughness=0.85)
    mat_disc = create_pbr_material("BrakeDiscSteel", color=(0.65, 0.68, 0.72, 1.0), metallic=0.9, roughness=0.2)
    mat_caliper = create_pbr_material("BrakeCaliperRed", color=(0.85, 0.08, 0.08, 1.0), metallic=0.5, roughness=0.3)
    mat_headlight = create_pbr_material("LED_Headlight_Halo", color=(1.0, 0.98, 0.9, 1.0), emissive=(1.0, 0.98, 0.9, 1.0), emissive_strength=4.5)
    mat_taillight = create_pbr_material("LED_Taillight_KarooRed", color=(1.0, 0.05, 0.08, 1.0), emissive=(1.0, 0.05, 0.08, 1.0), emissive_strength=5.0)
    mat_badge_blue = create_pbr_material("Karoo_Badge_Blue", color=(0.02, 0.15, 0.4, 1.0), metallic=0.8, roughness=0.2)

    root = bpy.data.objects.new("Karoo_Vonk_Hatch", None)
    collection.objects.link(root)

    # Main Hatchback Lower Body
    body = add_mesh_child("Body_Chassis", 'cube', (0, 0, 0.48), (1.68, 3.4, 0.58), mat=mat_paint, bevel_width=0.14, parent=root)
    sub = body.modifiers.new(name="Subsurf", type='SUBSURF')
    sub.levels = 2
    sub.render_levels = 2

    # Curved Bianco White Retro Roof
    roof = add_mesh_child("Body_Roof_Bianco", 'cube', (0, -0.15, 0.98), (1.38, 1.85, 0.52), mat=mat_white_roof, bevel_width=0.18, parent=root)
    r_sub = roof.modifiers.new(name="Subsurf", type='SUBSURF')
    r_sub.levels = 2
    r_sub.render_levels = 2

    # Windows
    add_mesh_child("Glass_Windshield", 'cube', (0, 0.55, 0.96), (1.32, 0.65, 0.44), rot=(-0.45, 0, 0), mat=mat_glass, parent=root)
    add_mesh_child("Glass_RearWindow", 'cube', (0, -0.85, 0.98), (1.28, 0.55, 0.42), rot=(0.4, 0, 0), mat=mat_glass, parent=root)
    add_mesh_child("Body_Glass_Canopy", 'cube', (0, -0.15, 0.96), (1.40, 1.6, 0.42), mat=mat_glass, parent=root)

    # Front Fascia & Chrome Whiskers
    add_mesh_child("Chrome_Grille_Bar", 'cube', (0, 1.66, 0.46), (1.35, 0.08, 0.06), mat=mat_chrome, bevel_width=0.02, parent=root)
    add_mesh_child("Karoo_Badge_Chrome", 'cylinder', (0, 1.68, 0.52), (0.16, 0.04, 0.16), rot=(math.pi/2, 0, 0), mat=mat_chrome, parent=root)
    add_mesh_child("Karoo_Badge_Logo", 'cylinder', (0, 1.69, 0.52), (0.12, 0.045, 0.12), rot=(math.pi/2, 0, 0), mat=mat_badge_blue, parent=root)

    # Round Headlights & Foglights
    for x_side in [-0.58, 0.58]:
        add_mesh_child(f"Headlight_Chrome_Ring_{x_side}", 'cylinder', (x_side, 1.66, 0.56), (0.32, 0.06, 0.32), rot=(math.pi/2, 0, 0), mat=mat_chrome, parent=root)
        add_mesh_child(f"Headlight_LED_{x_side}", 'cylinder', (x_side, 1.67, 0.56), (0.26, 0.07, 0.26), rot=(math.pi/2, 0, 0), mat=mat_headlight, parent=root)
        add_mesh_child(f"Foglight_LED_{x_side}", 'cylinder', (x_side * 0.75, 1.67, 0.35), (0.16, 0.05, 0.16), rot=(math.pi/2, 0, 0), mat=mat_headlight, parent=root)

    # Lower Honeycomb Intake
    add_mesh_child("Front_Bumper_Lower_Grille", 'cube', (0, 1.67, 0.28), (1.2, 0.06, 0.14), mat=mat_black_trim, bevel_width=0.02, parent=root)

    # Rear Fascia & Vertical Taillights
    for x_side in [-0.68, 0.68]:
        add_mesh_child(f"Taillight_Chrome_Border_{x_side}", 'cube', (x_side, -1.66, 0.65), (0.24, 0.06, 0.42), mat=mat_chrome, bevel_width=0.03, parent=root)
        add_mesh_child(f"LED_Taillight_{x_side}", 'cube', (x_side, -1.67, 0.65), (0.18, 0.07, 0.36), mat=mat_taillight, parent=root)

    add_mesh_child("Rear_Hatch_Chrome_Handle", 'cube', (0, -1.67, 0.48), (0.6, 0.06, 0.06), mat=mat_chrome, parent=root)
    add_mesh_child("Rear_Bumper_Diffuser", 'cube', (0, -1.66, 0.26), (1.4, 0.12, 0.15), mat=mat_black_trim, parent=root)
    add_mesh_child("Chrome_Exhaust_Tip", 'cylinder', (0.42, -1.68, 0.24), (0.1, 0.25, 0.1), rot=(math.pi/2, 0, 0), mat=mat_chrome, parent=root)

    # License Plates & Side Mirrors
    add_mesh_child("License_Plate_Front", 'cube', (0, 1.69, 0.38), (0.46, 0.02, 0.12), mat=mat_rim, parent=root)
    add_mesh_child("License_Plate_Rear", 'cube', (0, -1.68, 0.38), (0.46, 0.02, 0.12), mat=mat_rim, parent=root)

    for x_side in [-0.85, 0.85]:
        add_mesh_child(f"Side_Skirt_{x_side}", 'cube', (x_side, 0, 0.22), (0.08, 2.2, 0.1), mat=mat_black_trim, parent=root)
        add_mesh_child(f"Side_Mirror_{x_side}", 'uvsphere', (x_side * 0.92, 0.45, 0.88), (0.18, 0.18, 0.18), mat=mat_chrome, parent=root)

    # Wheels & Brakes
    def create_vonk_wheel(name, x, y, z):
        wheel_empty = bpy.data.objects.new(name, None)
        wheel_empty.location = (x, y, z)
        collection.objects.link(wheel_empty)
        wheel_empty.parent = root

        radius = 0.33
        width = 0.22
        add_mesh_child(f"{name}_Tire", 'cylinder', (0, 0, 0), (radius * 2, width, radius * 2), rot=(0, 0, math.pi/2), mat=mat_tire, bevel_width=0.04, parent=wheel_empty, vertices=48)
        add_mesh_child(f"{name}_Rim_Lip", 'cylinder', (0, 0, 0), (radius * 1.55, width + 0.01, radius * 1.55), rot=(0, 0, math.pi/2), mat=mat_rim, parent=wheel_empty, vertices=48)
        for i in range(4):
            angle = (i * math.pi) / 2
            add_mesh_child(f"{name}_Spoke_{i}", 'cube', (0, 0, 0), (width + 0.015, radius * 1.4, 0.04), rot=(angle, 0, 0), mat=mat_rim, parent=wheel_empty)
        add_mesh_child(f"{name}_Hub_Cap", 'cylinder', (0, 0, 0), (0.16, width + 0.02, 0.16), rot=(0, 0, math.pi/2), mat=mat_chrome, parent=wheel_empty)

        disc_x = -0.04 if x > 0 else 0.04
        add_mesh_child(f"{name}_BrakeDisc", 'cylinder', (disc_x, 0, 0), (radius * 1.2, 0.02, radius * 1.2), rot=(0, 0, math.pi/2), mat=mat_disc, parent=wheel_empty)
        caliper_x = -0.05 if x > 0 else 0.05
        add_mesh_child(f"{name}_BrakeCaliper", 'cube', (caliper_x, 0, radius * 0.25), (0.06, 0.16, 0.1), mat=mat_caliper, parent=wheel_empty)

    create_vonk_wheel("Wheel_FL", -0.78, 1.05, 0.33)
    create_vonk_wheel("Wheel_FR", 0.78, 1.05, 0.33)
    create_vonk_wheel("Wheel_RL", -0.78, -1.05, 0.33)
    create_vonk_wheel("Wheel_RR", 0.78, -1.05, 0.33)

    add_mesh_child("Axle_Front", 'cylinder', (0, 1.05, 0.33), (0.08, 1.52, 0.08), rot=(0, 0, math.pi/2), mat=mat_black_trim, parent=root)
    add_mesh_child("Axle_Rear", 'cylinder', (0, -1.05, 0.33), (0.08, 1.52, 0.08), rot=(0, 0, math.pi/2), mat=mat_black_trim, parent=root)

    # Export
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB', export_apply=True)
    print(f"SUCCESS: Exported Karoo Vonk 1.1 to {output_path}")


# ==============================================================================
# 2. KAROO KAAP GT-V8 (Heritage V8 Coupe)
# ==============================================================================
def build_karoo_kaap_gt(output_path):
    print(f"Building Karoo Kaap GT-V8 -> {output_path}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collection = bpy.context.collection

    # Materials
    mat_paint = create_pbr_material("CarPaint_KarooCrimson", color=(0.76, 0.06, 0.08, 1.0), metallic=0.92, roughness=0.14, clearcoat=1.0)
    mat_carbon = create_pbr_material("CarbonFiber", color=(0.03, 0.03, 0.04, 1.0), metallic=0.7, roughness=0.35)
    mat_glass = create_pbr_material("TintedGlass", color=(0.05, 0.08, 0.12, 1.0), metallic=0.1, roughness=0.04, transmission=0.90, opacity=0.35)
    mat_rim = create_pbr_material("SilverAlloy", color=(0.88, 0.90, 0.93, 1.0), metallic=0.98, roughness=0.08)
    mat_tire = create_pbr_material("TireRubber", color=(0.05, 0.05, 0.05, 1.0), metallic=0.02, roughness=0.85)
    mat_caliper = create_pbr_material("BrakeCaliperGold", color=(0.88, 0.68, 0.12, 1.0), metallic=0.7, roughness=0.25)
    mat_disc = create_pbr_material("BrakeDiscSteel", color=(0.62, 0.65, 0.68, 1.0), metallic=0.9, roughness=0.22)
    mat_headlight = create_pbr_material("LED_Headlight_Cool", color=(0.85, 0.95, 1.0, 1.0), emissive=(0.85, 0.95, 1.0, 1.0), emissive_strength=5.5)
    mat_taillight = create_pbr_material("LED_Taillight_Red", color=(1.0, 0.04, 0.08, 1.0), emissive=(1.0, 0.04, 0.08, 1.0), emissive_strength=6.0)
    mat_chrome = create_pbr_material("ExhaustChrome", color=(0.92, 0.94, 0.97, 1.0), metallic=1.0, roughness=0.04)
    mat_mirror = create_pbr_material("MirrorGlass", color=(0.95, 0.95, 0.98, 1.0), metallic=1.0, roughness=0.01)

    root = bpy.data.objects.new("Karoo_Kaap_GT_V8", None)
    collection.objects.link(root)

    # Main V8 Coupe Body Chassis
    body = add_mesh_child("Body_Chassis", 'cube', (0, 0, 0.55), (2.06, 4.5, 0.62), mat=mat_paint, bevel_width=0.12, parent=root)
    b_sub = body.modifiers.new(name="Subsurf", type='SUBSURF')
    b_sub.levels = 2
    b_sub.render_levels = 2

    # Fastback Cabin & Glass Canopy
    cabin = add_mesh_child("Body_Glass_Canopy", 'cube', (0, -0.1, 1.12), (1.42, 2.2, 0.52), mat=mat_glass, bevel_width=0.18, parent=root)
    c_sub = cabin.modifiers.new(name="Subsurf", type='SUBSURF')
    c_sub.levels = 2
    c_sub.render_levels = 2

    add_mesh_child("Roof_Pillars", 'cube', (0, -0.1, 1.36), (1.4, 2.15, 0.06), mat=mat_paint, parent=root)

    # Front Aerodynamics: Splitter & Grille Intakes
    add_mesh_child("Front_Splitter", 'cube', (0, 2.22, 0.28), (2.12, 0.6, 0.08), mat=mat_carbon, parent=root)
    add_mesh_child("Front_Grille_Intake", 'cube', (0, 2.23, 0.42), (1.65, 0.1, 0.22), mat=mat_carbon, parent=root)

    # Rear Aerodynamics: Diffuser & Quad Chrome Exhaust Pipes
    add_mesh_child("Rear_Diffuser", 'cube', (0, -2.22, 0.38), (1.95, 0.5, 0.24), rot=(0.12, 0, 0), mat=mat_carbon, parent=root)
    for x_side in [-0.65, -0.45, 0.45, 0.65]:
        add_mesh_child(f"Exhaust_Pipe_{x_side}", 'cylinder', (x_side, -2.25, 0.36), (0.12, 0.35, 0.12), rot=(math.pi/2, 0, 0), mat=mat_chrome, parent=root)

    # Side Skirts & Mirrors
    for x_side in [-1.04, 1.04]:
        add_mesh_child(f"Side_Skirt_{x_side}", 'cube', (x_side, 0, 0.3), (0.12, 2.7, 0.12), mat=mat_carbon, parent=root)
        rot_z = 0.2 if x_side > 0 else -0.2
        add_mesh_child(f"Side_Mirror_Body_{x_side}", 'cube', (x_side, 0.65, 1.02), (0.28, 0.18, 0.12), rot=(0, 0, rot_z), mat=mat_paint, parent=root)
        add_mesh_child(f"Side_Mirror_Glass_{x_side}", 'cube', (x_side, 0.62, 1.02), (0.25, 0.02, 0.1), mat=mat_mirror, parent=root)

    # Front Lighting: Projectors & DRL Lightbar
    for x_side in [-0.75, 0.75]:
        rot_y = 0.15 if x_side > 0 else -0.15
        add_mesh_child(f"Headlight_LED_{x_side}", 'cube', (x_side, 2.15, 0.65), (0.45, 0.15, 0.08), rot=(0, rot_y, 0), mat=mat_headlight, parent=root)

    add_mesh_child("Front_DRL_Lightbar", 'cube', (0, 2.18, 0.68), (1.68, 0.06, 0.04), mat=mat_headlight, parent=root)

    # Rear Lighting: Full-Width LED Taillight Bar
    add_mesh_child("Rear_LED_Taillight", 'cube', (0, -2.18, 0.76), (1.88, 0.08, 0.08), mat=mat_taillight, parent=root)

    # Active Rear GT Spoiler on Struts
    add_mesh_child("Spoiler_Active", 'cube', (0, -1.9, 1.08), (1.85, 0.38, 0.05), mat=mat_carbon, bevel_width=0.02, parent=root)
    for x_side in [-0.55, 0.55]:
        add_mesh_child(f"Spoiler_Strut_{x_side}", 'cube', (x_side, -1.9, 0.94), (0.05, 0.15, 0.22), mat=mat_carbon, parent=root)

    # License Plates
    add_mesh_child("License_Plate_Front", 'cube', (0, 2.24, 0.52), (0.5, 0.02, 0.12), mat=mat_rim, parent=root)
    add_mesh_child("License_Plate_Rear", 'cube', (0, -2.24, 0.52), (0.5, 0.02, 0.12), rot=(0, 0, math.pi), mat=mat_rim, parent=root)

    # High-Performance Wheels (FL, FR, RL, RR)
    def create_gt_wheel(name, x, y, z, is_front):
        wheel_empty = bpy.data.objects.new(name, None)
        wheel_empty.location = (x, y, z)
        collection.objects.link(wheel_empty)
        wheel_empty.parent = root

        radius = 0.44 if is_front else 0.47
        width = 0.28 if is_front else 0.34
        add_mesh_child(f"{name}_Tire", 'cylinder', (0, 0, 0), (radius * 2, width, radius * 2), rot=(0, 0, math.pi/2), mat=mat_tire, bevel_width=0.05, parent=wheel_empty, vertices=48)
        add_mesh_child(f"{name}_Rim", 'cylinder', (0, 0, 0), (radius * 1.56, width + 0.01, radius * 1.56), rot=(0, 0, math.pi/2), mat=mat_rim, parent=wheel_empty, vertices=48)

        # 5-Twin-Spoke Geometry
        for i in range(5):
            angle = (i * math.pi * 2) / 5
            for offset in [-0.08, 0.08]:
                add_mesh_child(f"{name}_Spoke_{i}_{offset}", 'cube', (0, 0, 0), (width + 0.015, 0.04, radius * 0.72), rot=(angle + offset, 0, 0), mat=mat_rim, parent=wheel_empty)

        disc_x = -0.05 if x > 0 else 0.05
        add_mesh_child(f"{name}_BrakeDisc", 'cylinder', (disc_x, 0, 0), (radius * 1.36, 0.03, radius * 1.36), rot=(0, 0, math.pi/2), mat=mat_disc, parent=wheel_empty, vertices=32)
        caliper_x = -0.06 if x > 0 else 0.06
        add_mesh_child(f"{name}_BrakeCaliper", 'cube', (caliper_x, 0, radius * 0.35), (0.08, 0.22, 0.14), mat=mat_caliper, parent=wheel_empty)

    create_gt_wheel("Wheel_FL", -0.98, 1.40, 0.44, True)
    create_gt_wheel("Wheel_FR", 0.98, 1.40, 0.44, True)
    create_gt_wheel("Wheel_RL", -1.02, -1.38, 0.47, False)
    create_gt_wheel("Wheel_RR", 1.02, -1.38, 0.47, False)

    add_mesh_child("Axle_Front", 'cylinder', (0, 1.40, 0.44), (0.1, 1.94, 0.1), rot=(0, 0, math.pi/2), mat=mat_carbon, parent=root)
    add_mesh_child("Axle_Rear", 'cylinder', (0, -1.38, 0.47), (0.1, 2.02, 0.1), rot=(0, 0, math.pi/2), mat=mat_carbon, parent=root)

    # Export
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB', export_apply=True)
    print(f"SUCCESS: Exported Karoo Kaap GT-V8 to {output_path}")


if __name__ == "__main__":
    vonk_out = os.path.abspath("public/assets/citylife/cars/karoo_vonk.glb")
    kaap_out = os.path.abspath("public/assets/citylife/cars/karoo_kaap_gt.glb")

    build_karoo_vonk(vonk_out)
    build_karoo_kaap_gt(kaap_out)
    print("All showroom GLB models generated successfully!")
