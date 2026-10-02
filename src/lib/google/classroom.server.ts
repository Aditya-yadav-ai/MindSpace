/** Stage 6 — Classroom Agent's real API surface. Read-only: this app never posts to a classroom on the user's behalf. */
import { googleApiFetch } from "./api-fetch.server";
import type { ClassroomCourseSummary, ClassroomCourseWorkSummary } from "./types";

const BASE = "https://classroom.googleapis.com/v1/courses";

export async function listCourses(
  accessToken: string,
  limit: number,
): Promise<ClassroomCourseSummary[]> {
  const result = await googleApiFetch<{
    courses?: { id: string; name: string; section?: string; courseState: string }[];
  }>(accessToken, `${BASE}?pageSize=${limit}&courseStates=ACTIVE`);
  return (result.courses ?? []).map((course) => ({
    id: course.id,
    name: course.name,
    section: course.section ?? null,
    courseState: course.courseState,
  }));
}

export async function listCourseWork(
  accessToken: string,
  courseId: string,
  limit: number,
): Promise<ClassroomCourseWorkSummary[]> {
  const result = await googleApiFetch<{
    courseWork?: {
      id: string;
      title: string;
      dueDate?: { year: number; month: number; day: number };
      state: string;
    }[];
  }>(accessToken, `${BASE}/${encodeURIComponent(courseId)}/courseWork?pageSize=${limit}`);
  return (result.courseWork ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    dueDate: item.dueDate
      ? `${item.dueDate.year}-${String(item.dueDate.month).padStart(2, "0")}-${String(item.dueDate.day).padStart(2, "0")}`
      : null,
    state: item.state,
  }));
}
