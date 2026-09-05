"""Experimental reference-oriented view of predictions; preserves the raw result.

These groups describe visible details, not why the owner saved an image.
Unknown tags remain in the raw output. This is not a content/display filter.
"""

GROUPS = {
    "Pose and gesture": "standing sitting kneeling squatting crouching lying jumping running walking leaning_forward leaning_back contrapposto crossed_legs crossed_arms arms_up arm_up hand_on_hip hands_on_hips hand_on_own_face hand_on_own_cheek hand_on_own_chin reaching reaching_out outstretched_arm outstretched_arms looking_back head_tilt fighting_stance on_one_knee on_back on_side on_stomach hand_to_mouth hands_together",
    "Viewpoint and depth": "from_above from_below from_side from_behind dutch_angle foreshortening perspective fisheye wide_shot profile facing_viewer over_shoulder looking_over_shoulder",
    "Framing and composition": "portrait close-up upper_body cowboy_shot full_body cropped head_out_of_frame feet_out_of_frame hand_out_of_frame facing_away symmetry reflection mirror silhouette depth_of_field blurry_background foreground backlighting against_wall sitting_on_stairs",
    "Lighting and atmosphere": "backlighting sunlight sunbeam shadow dramatic_shadow dappled_sunlight sunset night neon_lights glowing rim_lighting lens_flare motion_blur rain wet water_drop wind",
    "Expression and eyes": "smile grin smirk frown pout open_mouth closed_mouth clenched_teeth parted_lips closed_eyes one_eye_closed half-closed_eyes narrowed_eyes wide-eyed looking_at_viewer looking_away looking_down looking_up blush tears crying laughing surprised angry expressionless",
    "Clothing construction": "detached_sleeves puffy_sleeves wide_sleeves sleeves_rolled_up sleeves_pushed_up sleeve_cuffs frilled_sleeves long_sleeves short_sleeves asymmetrical_sleeves single_sleeve pleated_skirt plaid_skirt frills ruffles lace lace_trim embroidery buttons zipper belt buckle ribbon bow necktie scarf corset gloves fingerless_gloves layered_clothes coat jacket hood hood_up off_shoulder bare_shoulders collarbone clothing_cutout cutout navel_cutout fabric_folds",
    "Hands and props": "hand_fan folding_fan holding_fan holding_weapon holding_sword holding_gun holding_book holding_cup holding_flower holding_umbrella holding_phone holding_camera bicycle umbrella book cup flower camera sword gun polearm staff thread instrument musical_instrument glasses eyewear_on_head",
}
TAG_GROUPS = {tag: group for group, words in GROUPS.items() for tag in words.split()}
TAG_GROUPS.update({tag: 'Pose and gesture' for tag in (
    'standing_on_one_leg leg_up legs_up tiptoes plantar_flexion hands_on_feet '
    'heart_hands hands_up hand_up salute v peace_sign finger_gun pointing '
    'index_finger_raised shushing finger_to_mouth own_hands_together '
    'interlocked_fingers crossed_fingers hand_on_own_head hand_behind_head '
    'arms_behind_head arms_behind_back hands_behind_back bending_over '
    'head_rest cheek_rest hugging dancing ballet stretching').split()})
TAG_GROUPS.update({tag: 'Viewpoint and depth' for tag in 'straight-on three-quarter_view vanishing_point'.split()})


def reference_facets(tags, threshold=.35, limit=8):
    if not 0 <= threshold <= 1 or limit < 1:
        raise ValueError("Invalid facet threshold or limit")
    grouped = {group: [] for group in GROUPS}
    by_name = {}
    for tag in tags:
        name = tag['name']
        if tag.get('category') != 'general' or tag['confidence'] <= threshold or name not in TAG_GROUPS:
            continue
        if name not in by_name or tag['confidence'] > by_name[name]['confidence']:
            by_name[name] = dict(tag)
    for tag in sorted(by_name.values(), key=lambda t: (-t['confidence'], t['name'])):
        group = grouped[TAG_GROUPS[tag['name']]]
        if len(group) < limit:
            group.append(tag)
    return {group: tags for group, tags in grouped.items() if tags}


def community_reference_facets(names, limit=8):
    """Group attributed community terms without inventing confidence scores."""
    if limit < 1:
        raise ValueError('Invalid group limit')
    groups = {group: [] for group in GROUPS}
    for name in sorted(set(names)):
        if name in TAG_GROUPS and len(groups[TAG_GROUPS[name]]) < limit:
            groups[TAG_GROUPS[name]].append(name)
    return {group: terms for group, terms in groups.items() if terms}
