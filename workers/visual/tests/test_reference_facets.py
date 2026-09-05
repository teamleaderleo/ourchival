import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reference_facets import reference_facets, community_reference_facets


class ReferenceFacetsTest(unittest.TestCase):
    def test_community_terms_have_no_fabricated_scores(self):
        self.assertEqual(community_reference_facets(['heart_hands', '1girl', 'heart_hands']), {'Pose and gesture': ['heart_hands']})

    def test_reference_view_preserves_raw_predictions(self):
        tags = [dict(name=n, confidence=.8, category='general') for n in ['1girl', 'from_below', 'foreshortening', 'detached_sleeves', 'breasts']]
        result = reference_facets(tags)
        self.assertEqual([t['name'] for t in result['Viewpoint and depth']], ['foreshortening', 'from_below'])
        self.assertEqual(len(tags), 5)
        self.assertNotIn('1girl', [t['name'] for group in result.values() for t in group])

    def test_threshold_dedup_and_group_limit(self):
        tags = [dict(name=n, confidence=c, category='general') for n, c in [('sitting', .2), ('from_below', .4), ('from_below', .9), ('from_side', .8)]]
        result = reference_facets(tags, threshold=.35, limit=1)
        self.assertNotIn('Pose and gesture', result)
        self.assertEqual(result['Viewpoint and depth'][0]['confidence'], .9)
        self.assertEqual(len(result['Viewpoint and depth']), 1)


if __name__ == '__main__':
    unittest.main()
