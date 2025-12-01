from collections import OrderedDict
from typing import List

from django.conf import settings

from exercise.cache.content import LearningObjectContent

# Generate students' results from this course instance
# Results are returned in a compact nested format with zeros omitted:
#
# JSON format example:
# {
#   "UserID": 13,
#   "exercises": {
#     "22": {"c": 3, "t": 10},
#     "48": {"c": 2, "t": 2, "uc": 1, "ut": 5}  // only when unofficial differs
#   },
#   "totals": {"c": 12, "t": 117, "uc": 1, "ut": 5}
# }
# Keys: c=official_count, t=official_total, uc=unofficial_count, ut=unofficial_total

# pylint: disable-next=too-many-locals
def aggregate_points(profiles, taggings, exercises: List[LearningObjectContent], aggregate):
    DEFAULT_FIELDS = [
        'UserID', 'StudentID', 'Email', 'Name', 'Tags', 'Organization',
    ]

    agg = {}
    # Gather exercise points per student (now with official/all counts)
    for row in aggregate:
        ex = row['exercise_id']
        user_row = agg.get(row['submitters__user_id'], {})
        user_row[ex] = {
            'official_count': row['official_count'],
            'official_total': row['official_total'],
            'all_count': row['all_count'],
            'all_total': row['all_total'],
        }
        agg[row['submitters__user_id']] = user_row

    # Prefetch all tag_id - user_id pairs at once from DB to avoid multiple queries
    # TODO: Ideally this should probably be done in api.csv.views
    all_tags = list(taggings.all().values('user_id','tag_id'))

    sheet = []

    for profile in profiles:
        uid = profile.user.id
        user_row = agg.get(uid, {})
        user_tags = [
            settings.EXTERNAL_USER_LABEL.lower() if profile.is_external else settings.INTERNAL_USER_LABEL.lower()
        ]
        # Instead of filtering the Django resultset (which causes a new DB query),
        # we find the users' tags manually from the prefetched array of dicts
        other_tags = list(item for item in all_tags if item["user_id"] == profile.id)
        #other_tags = all_tags.all().filter(user_id=profile.id)
        for tag in other_tags:
            user_tags.append(str(tag['tag_id']))
        #user_tags.extend(tags.get(uid, []))
        row = OrderedDict([
            ('UserID', uid),
            ('Email', profile.user.email),
            ('StudentID', profile.student_id),
            ('Name', profile.user.first_name + ' ' + profile.user.last_name),
            ('Tags', '|'.join(user_tags)),
            ('Organization', profile.organization),
        ])

        # Add exercise data in compact nested format with zeros omitted
        exercises_nested = {}
        if uid in agg:
            student_official_count = 0
            student_official_total = 0
            student_all_count = 0
            student_all_total = 0

            for ex_id, ex_data in agg[uid].items():
                student_official_count += ex_data['official_count']
                student_official_total += ex_data['official_total']
                student_all_count += ex_data['all_count']
                student_all_total += ex_data['all_total']

                # Compact nested format: only include non-zero values
                ex_nested = {'c': ex_data['official_count'], 't': ex_data['official_total']}

                # Only add unofficial fields if they differ from official (omit zeros)
                unofficial_count = ex_data['all_count'] - ex_data['official_count']
                unofficial_total = ex_data['all_total'] - ex_data['official_total']
                if unofficial_count > 0:
                    ex_nested['uc'] = unofficial_count
                if unofficial_total > 0:
                    ex_nested['ut'] = unofficial_total

                exercises_nested[str(ex_id)] = ex_nested

            # Add nested exercises object
            row['exercises'] = exercises_nested

            # Add totals in nested format
            totals_nested = {'c': student_official_count, 't': student_official_total}
            unofficial_total_count = student_all_count - student_official_count
            unofficial_total_total = student_all_total - student_official_total
            if unofficial_total_count > 0:
                totals_nested['uc'] = unofficial_total_count
            if unofficial_total_total > 0:
                totals_nested['ut'] = unofficial_total_total

            row['totals'] = totals_nested

        sheet.append(row)

    return sheet, DEFAULT_FIELDS
