/**
 * Stage 8 — Google Classroom API service adapter.
 * Uses the official Google Classroom API (v1).
 * Supports listing courses, retrieving course details, coursework,
 * announcements, student submissions, and creating announcements & coursework with approval.
 */
import { googleApiFetch } from "./api-fetch.server";
import type {
  ClassroomAnnouncement,
  ClassroomCourseSummary,
  ClassroomCourseWorkSummary,
  CourseMaterial,
  CourseWorkCreateInput,
  StudentSubmission,
} from "./types";

const BASE = "https://classroom.googleapis.com/v1";

/**
 * Lists active courses for the authenticated user.
 */
export async function listCourses(
  accessToken: string,
  limit: number = 10,
): Promise<ClassroomCourseSummary[]> {
  const result = await googleApiFetch<{
    courses?: { id: string; name: string; section?: string; courseState: string }[];
  }>(accessToken, `${BASE}/courses?pageSize=${Math.min(limit, 30)}&courseStates=ACTIVE`);
  return (result.courses ?? []).map((course) => ({
    id: course.id,
    name: course.name,
    section: course.section ?? null,
    courseState: course.courseState,
  }));
}

/**
 * Retrieves full details of a specific Classroom course.
 */
export async function getCourse(
  accessToken: string,
  courseId: string,
): Promise<ClassroomCourseSummary> {
  const course = await googleApiFetch<{
    id: string;
    name: string;
    section?: string;
    courseState: string;
  }>(accessToken, `${BASE}/courses/${encodeURIComponent(courseId)}`);
  return {
    id: course.id,
    name: course.name,
    section: course.section ?? null,
    courseState: course.courseState,
  };
}

/**
 * Lists coursework (assignments, questions) for a course.
 */
export async function listCourseWork(
  accessToken: string,
  courseId: string,
  limit: number = 10,
): Promise<ClassroomCourseWorkSummary[]> {
  const result = await googleApiFetch<{
    courseWork?: {
      id: string;
      title: string;
      dueDate?: { year: number; month: number; day: number };
      state: string;
    }[];
  }>(
    accessToken,
    `${BASE}/courses/${encodeURIComponent(courseId)}/courseWork?pageSize=${Math.min(limit, 30)}`,
  );
  return (result.courseWork ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    dueDate: item.dueDate
      ? `${item.dueDate.year}-${String(item.dueDate.month).padStart(2, "0")}-${String(item.dueDate.day).padStart(2, "0")}`
      : null,
    state: item.state,
  }));
}

/**
 * Lists announcements posted in a Classroom course.
 */
export async function listAnnouncements(
  accessToken: string,
  courseId: string,
  limit: number = 10,
): Promise<ClassroomAnnouncement[]> {
  const result = await googleApiFetch<{
    announcements?: {
      id: string;
      text?: string;
      state: string;
      updateTime: string;
    }[];
  }>(
    accessToken,
    `${BASE}/courses/${encodeURIComponent(courseId)}/announcements?pageSize=${Math.min(limit, 30)}`,
  );
  return (result.announcements ?? []).map((a) => ({
    id: a.id,
    text: a.text ?? "",
    state: a.state,
    updateTime: a.updateTime,
  }));
}

/**
 * Lists student submissions for a specific coursework item.
 */
export async function listStudentSubmissions(
  accessToken: string,
  courseId: string,
  courseWorkId: string,
  limit: number = 20,
): Promise<StudentSubmission[]> {
  const result = await googleApiFetch<{
    studentSubmissions?: {
      id: string;
      userId: string;
      state: string;
      assignedGrade?: number;
    }[];
  }>(
    accessToken,
    `${BASE}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions?pageSize=${Math.min(limit, 50)}`,
  );
  return (result.studentSubmissions ?? []).map((s) => ({
    id: s.id,
    userId: s.userId,
    state: s.state,
    assignedGrade: s.assignedGrade,
  }));
}

/**
 * Retrieves course materials from coursework materials field.
 */
export async function getCourseMaterials(
  accessToken: string,
  courseId: string,
): Promise<CourseMaterial[]> {
  const result = await googleApiFetch<{
    courseWorkMaterials?: {
      id: string;
      title: string;
      materials?: { link?: { url: string; title?: string } }[];
    }[];
  }>(
    accessToken,
    `${BASE}/courses/${encodeURIComponent(courseId)}/courseWorkMaterials?pageSize=20`,
  );
  return (result.courseWorkMaterials ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    link: m.materials?.[0]?.link?.url,
  }));
}

/**
 * Creates an announcement in a Classroom course.
 * Callers must gate this behind explicit user approval.
 */
export async function createAnnouncement(
  accessToken: string,
  courseId: string,
  text: string,
): Promise<ClassroomAnnouncement> {
  const created = await googleApiFetch<{
    id: string;
    text?: string;
    state: string;
    updateTime: string;
  }>(accessToken, `${BASE}/courses/${encodeURIComponent(courseId)}/announcements`, {
    method: "POST",
    body: JSON.stringify({
      text,
      state: "PUBLISHED",
    }),
  });
  return {
    id: created.id,
    text: created.text ?? text,
    state: created.state,
    updateTime: created.updateTime,
  };
}

/**
 * Creates coursework in a Classroom course where permitted.
 * Callers must gate this behind explicit user approval.
 */
export async function createCourseWork(
  accessToken: string,
  courseId: string,
  input: CourseWorkCreateInput,
): Promise<ClassroomCourseWorkSummary> {
  const created = await googleApiFetch<{
    id: string;
    title: string;
    state: string;
  }>(accessToken, `${BASE}/courses/${encodeURIComponent(courseId)}/courseWork`, {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      description: input.description,
      workType: "ASSIGNMENT",
      state: "PUBLISHED",
    }),
  });
  return {
    id: created.id,
    title: created.title,
    dueDate: null,
    state: created.state,
  };
}
