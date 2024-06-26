from django.test import TestCase
from course.models import Course, CourseInstance, CourseModule,\
    LearningObjectCategory
from exercise.exercise_models import StaticExercise
from django.contrib.auth.models import User
from django.utils import timezone
from django.conf import settings
from datetime import timedelta


class RedirectTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.user = User(username="testUser")
        cls.user.set_password("testPassword")
        cls.user.save()
        cls.user.userprofile.student_id = '123456'
        cls.user.userprofile.organization = settings.LOCAL_ORGANIZATION
        cls.user.userprofile.save()
        cls.course = Course.objects.create(
            name="test course",
            code="123456",
            url="Course-Url"
        )
        cls.course_instance = CourseInstance.objects.create(
            instance_name="Fall 2011",
            starting_time=timezone.now(),
            ending_time=timezone.now() + timedelta(days=5),
            course=cls.course,
            url="T-00.1000_2011",
            view_content_to=CourseInstance.VIEW_ACCESS.ENROLLMENT_AUDIENCE,
        )
        cls.course_module = CourseModule.objects.create(
            name="test module",
            url="test-module",
            points_to_pass=15,
            course_instance=cls.course_instance,
            opening_time=timezone.now(),
            closing_time=timezone.now() + timedelta(days=5)
        )
        cls.learning_object_category = LearningObjectCategory.objects.create(
            name="test category",
            course_instance=cls.course_instance,
            points_to_pass=5
        )
        cls.exercise = StaticExercise.objects.create(
            name="test exercise",
            course_module=cls.course_module,
            category=cls.learning_object_category,
            url='e1',
        )

    def test_course(self):
        response = self.client.get('/course/course/')
        self.assertEqual(response.status_code, 404)
        response = self.client.get('/course/Course-Url/', follow=True)
        self.assertTrue(response.redirect_chain)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'userprofile/login.html')

        self.client.login(username="testUser", password="testPassword")
        response = self.client.get('/course/Course-Url/', follow=True)
        self.assertTrue(response.redirect_chain)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'course/course.html')
        response = self.client.get('/another/course/Course-Url/')
        self.assertEqual(response.status_code, 404)

    def test_course_instance(self):
        self.client.login(username="testUser", password="testPassword")
        response = self.client.get('/course/Course-Url/foobar/', follow=True)
        self.assertEqual(response.status_code, 404)
        response = self.client.get('/course/Course-Url/T-00.1000_2011/', follow=True)
        self.assertTrue(response.redirect_chain)
        self.assertEqual(response.status_code, 200)
        response = self.client.get('/another/course/Course-Url/T-00.1000_2011/')
        self.assertEqual(response.status_code, 404)

    def test_exercise(self):
        self.client.login(username="testUser", password="testPassword")
        response = self.client.get('/exercise/100/', follow=True)
        self.assertEqual(response.status_code, 404)
        response = self.client.get('/exercise/{:d}'.format(self.exercise.id), follow=True)
        self.assertTrue(response.redirect_chain)
        self.assertEqual(response.status_code, 200)
        response = self.client.get('/foobar/exercise/{:d}'.format(self.exercise.id), follow=True)
        self.assertEqual(response.status_code, 404)

    def test_course_instance_exercise(self):
        self.client.login(username="testUser", password="testPassword")
        response = self.client.get('/Course-Url/T-00.1000_2011/exercises/{:d}'.format(self.exercise.id), follow=True)
        self.assertTrue(response.redirect_chain)
        self.assertEqual(response.status_code, 200)
        response = self.client.get('/Course-Url/T-00.1000_2011/test-module/e1/')
        self.assertEqual(response.status_code, 200)
