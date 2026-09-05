import unittest

from evaluate_transfer import eligible, methods, summarize


class TransferTests(unittest.TestCase):
    def test_excludes_shared_identity_but_not_missing_identity(self):
        target = {'file': 'a', 'md5': 'same', 'source_identity': ('x', '123')}
        self.assertFalse(eligible(target, {'file': 'b', 'md5': 'same'}))
        self.assertFalse(eligible(target, {'file': 'c', 'source_identity': ('x', '123')}))
        self.assertTrue(eligible({'file': 'a'}, {'file': 'b'}))

    def test_agreement_requires_two_neighbors_and_image_evidence(self):
        donors = [{'labels': ['sitting', 'from_above']}, {'labels': ['sitting', 'from_above']},
                  {'labels': ['standing']}]
        result = methods({'sitting': .2, 'from_above': .1, 'smile': .8}, donors)
        self.assertEqual(result['agreement'], {'sitting'})
        self.assertEqual(result['wd_plus_agreement'], {'smile', 'sitting'})
        self.assertEqual(result['wd_035'], {'smile'})

    def test_missing_labels_are_reported_as_unconfirmed(self):
        result = summarize([{'labels': ['sitting'], 'predictions': {'test': ['sitting', 'smile']}}])
        self.assertEqual(result['test']['unconfirmed'], 1)
        self.assertEqual(result['test']['agreement'], .5)
        self.assertEqual(result['test']['observed_recall'], 1)
